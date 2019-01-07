const GOOGLE_CLIENT_ID = '';
const GOOGLE_REDIRECT_URI = 'https://ringcentral.github.io/ringcentral-embeddable/redirect.html';
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/user.emails.read'
];

function combineURL(url, params = {}) {
  const mergedParams = Object.entries(params)
    .map(param => param.join('='))
    .join('&');
  const includeParam = url.includes('?');
  return `${url}${includeParam ? '&' : '?'}${mergedParams}`;
}

function getParamsFromRedirectUri(redirectUri) {
  const m = redirectUri.match(/[#?](.*)/);
  if (!m || m.length < 1) { return null; }
  const params = new URLSearchParams(m[1].split('#')[0]);
  return params
}

class GoogleClient {
  constructor() {
    this._token = {};
    this._userInfo = {};
    this._getTokenPromise = null;
    this._refreshTokenPromise = null;
    this._syncContactsPromise = null;
    this._tokenStorageKey = '__googleClient.token';
    this._personalContactsSyncInfoStorageKey = '__googleClient.personalContacts.syncInfo';
    this._personalContactsStorageKey = '__googleClient.personalContacts.data';
    this._directoryContactsStorageKey = '__googleClient.directoryContacts.data';
    this._directoryContactsSyncInfoStorageKey = '__googleClient.directoryContacts.syncInfo';
    this._init();
  }

  async _init() {
    if (!this._getTokenPromise) {
      this._getTokenPromise = this.getToken();
    }
    await this._getTokenPromise;
    this._getTokenPromise = null;
    if (this._token && this._token.accessToken) {
      await this.syncContacts();
    }
  }

  async getToken() {
    const data = await browser.storage.local.get(this._tokenStorageKey);
    const token = data[this._tokenStorageKey]
    if (!token) {
      this._token = {};
      return;
    }
    if (token.expiresAt < Date.now() + 5 * 60 * 1000) {
      await this.refresh();
    } else {
      this._token = token;
    }
    this.setUserInfo();
  }

  async _getDataFromStorage(key) {
    const data = await browser.storage.local.get(key);
    return data[key] || null;
  }

  async _setDataIntoStorage(key, value) {
    await browser.storage.local.set({
      [key]: value,
    });
  }

  async _setDatasIntoStorage(keyValueObject) {
    await browser.storage.local.set(keyValueObject);
  }

  async authorize(interactive = true) {
    const authUrl = combineURL('https://accounts.google.com/o/oauth2/v2/auth', {
      scope: encodeURIComponent(GOOGLE_SCOPES.join(' ')),
      redirect_uri: encodeURIComponent(GOOGLE_REDIRECT_URI),
      client_id: encodeURIComponent(GOOGLE_CLIENT_ID),
      response_type: 'token'
    });
    try {
      const redirectUri = await browser.identity.launchWebAuthFlow({
        interactive,
        url: authUrl,
      });
      const params = getParamsFromRedirectUri(redirectUri);
      this._token = {
        accessToken: params.get('access_token'),
        expiresAt: Date.now() + 1000 * parseInt(params.get('expires_in')),
        tokenType: params.get('token_type'),
        scope: params.get('scope'),
      };
      await this._setDataIntoStorage(this._tokenStorageKey, this._token);
      console.log('Authorize with google successfully.');
    } catch (e) {
      this._token = {};
      console.error('Authorize with google failed.', e);
    }
  }

  async unAuthorize() {
    const token = this._token.accessToken;
    this._token = {};
    await this._setDataIntoStorage(this._tokenStorageKey, {});
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async refresh() {
    if (!this._refreshTokenPromise) {
      this._refreshTokenPromise = this.authorize(false);
    }
    await this._refreshTokenPromise;
    this._refreshTokenPromise = null;
  }

  async checkAuthorize() {
    if (this._getTokenPromise) {
      await this._getTokenPromise;
    }
    if (this._token && this._token.expiresAt > Date.now()) {
      return true;
    }
    return false;
  }

  async fetch({ url, params, method = 'GET', body }) {
    if (this._getTokenPromise) {
      await this._getTokenPromise;
    }
    if (this._refreshTokenPromise) {
      await this._refreshTokenPromise;
    }
    if (!this._token || !this._token.accessToken) {
      return;
    }
    if (this._token.expiresAt < Date.now() + 5 * 60 * 1000) {
      await this.refresh();
    }
    if (!this._token || !this._token.accessToken) {
      return;
    }
    const query = {
      access_token: this._token.accessToken,
      alt: 'json',
      ...params,
    };
    const fullUrl = combineURL(url, query);
    const response = await fetch(fullUrl, {
      method,
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const result = response.json();
    return result;
  }

  async setUserInfo() {
    const response = await this.fetch({
      url: 'https://www.googleapis.com/userinfo/v2/me',
    });
    if (!response) {
      this._userInfo = {}
      return;
    }
    this._userInfo = response;
  }

  async queryPersonalContacts({ pageToken, syncToken } = {}) {
    const params = {
      personFields: "names,emailAddresses,phoneNumbers",
      pageSize: 200,
      requestSyncToken: true,
    };
    if (pageToken) {
      params.pageToken = pageToken;
    }
    if (syncToken) {
      params.syncToken = syncToken;
    }
    const result = await this.fetch({
      url: 'https://people.googleapis.com/v1/people/me/connections',
      params
    });
    return result;
  }

  async _queryFullPersonalContacts({ syncToken, pageToken } = {}) {
    const response = await this.queryPersonalContacts({ pageToken, syncToken });
    if (!response.nextPageToken) {
      return {
        connections: response.connections || [],
        nextSyncToken: response.nextSyncToken,
      };
    }
    const nextResponse = await this._queryFullPersonalContacts({ pageToken: response.nextPageToken, syncToken });
    const connections = response.connections || [];
    return {
      connections: connections.concat(nextResponse.connections || []),
      nextSyncToken: response.nextSyncToken,
    }
  }

  async _syncPersonalContacts() {
    try {
      const syncInfo = await this._getDataFromStorage(this._personalContactsSyncInfoStorageKey);
      const syncToken = syncInfo && syncInfo.syncToken;
      const response = await this._queryFullPersonalContacts({ syncToken });
      const oldContacts = await this._getDataFromStorage(this._personalContactsStorageKey) || [];
      const updatedContacts = [];
      const updatesContactIds = {};
      response.connections.forEach((c) => {
        const id = c.resourceName.replace('people/', '')
        updatedContacts.push(({
          id,
          name: (c.names[0] && c.names[0].displayName) || '',
          type: 'Google', // need to same as service name
          phoneNumbers:
            (c.phoneNumbers && c.phoneNumbers.map(p => ({ phoneNumber: p.value, phoneType: p.type }))) ||
            [],
          emails: (c.emailAddresses && c.emailAddresses.map(c => c.value)) || [],
        }));
        updatesContactIds[id] = 1;
      })
      await this._setDatasIntoStorage({
        [this._personalContactsSyncInfoStorageKey]: {
          syncToken: response.nextSyncToken,
          syncTimestamp: Date.now(),
        },
        [this._personalContactsStorageKey]:
          (oldContacts.filter(c => !updatesContactIds[c.id])).concat(updatedContacts),
      });
    } catch(e) {
      console.error('sync personal contacts failed', e);
      throw(e);
    }
  }

  async queryDirectoryContacts({pageToken } = {}) {
    const params = {
      showdeleted: 'false',
      maxResults: 500,
      orderBy: 'email',
      projection: 'full',
      sortOrder: 'ASCENDING',
      viewType: 'domain_public',
      customer: 'my_customer',
    };
    if (pageToken) {
      params.pageToken = pageToken;
    }
    const result = await this.fetch({
      url: 'https://www.googleapis.com/admin/directory/v1/users',
      params
    });
    console.log(result);
    return result;
  }

  async _queryFullDirectoryContacts({ pageToken } = {}) {
    const response = await this.queryDirectoryContacts({ pageToken });
    if (!response.nextPageToken) {
      return response;
    }
    const nextResponse = await this._queryFullDirectoryContacts({ pageToken: response.nextPageToken });
    const users = response.users || [];
    return {
      users: users.concat(nextResponse.users || []),
      kind: response.kind,
      etag: response.etag,
    };
  }

  async _syncDirectoryContacts() {
    if (!this._userInfo.hd) {
      return null;
    }
    try {
      const response = await this._queryFullDirectoryContacts();
      await this._setDatasIntoStorage({
        [this._directoryContactsStorageKey]: response.users.map((c) => ({
          id: c.id,
          name: (c.name && c.name.fullName) || '',
          type: 'Google', // need to same as service name
          phoneNumbers:
            (c.phones && c.phones.map(p => ({ phoneNumber: p.value, phoneType: p.type }))) ||
            [],
          emails: (c.emails && c.emails.map(c => c.address)) || [],
        })),
        [this._directoryContactsSyncInfoStorageKey]: {
          syncTimestamp: Date.now(),
        },
      });
    } catch (e) {
      console.error('sync directory contacts failed', e);
      throw(e);
    }
  }

  async _syncContacts({ force = false }) {
    const personalContactSyncInfo = await this._getDataFromStorage(this._personalContactsSyncInfoStorageKey);
    const personalSyncTimestamp = personalContactSyncInfo && personalContactSyncInfo.syncTimestamp;
    if (force || personalSyncTimestamp + 30 * 1000 < Date.now()) {
      await this._syncPersonalContacts();
    }
    const directoryContactsSyncInfo = await this._getDataFromStorage(this._directoryContactsSyncInfoStorageKey);
    const directorySyncTimestamp = directoryContactsSyncInfo && directoryContactsSyncInfo.syncTimestamp;
    if (force || directorySyncTimestamp + 5 * 60 * 1000 < Date.now()) {
      await this._syncDirectoryContacts();
    }
  }

  async getContactSyncTimestamp() {
    
    if (!personalSyncTimestamp || !directorySyncTimestamp) {
      return null;
    }
    return personalSyncTimestamp > directorySyncTimestamp ? personalSyncTimestamp : directorySyncTimestamp;
  }

  async syncContacts({ force = false } = {}) {
    if (this._syncContactsPromise) {
      await this._syncContactsPromise;
      return;
    }
    this._syncContactsPromise = this._syncContacts({ force });
    await this._syncContactsPromise;
    this._syncContactsPromise = null;
  }

  async queryContacts({ syncTimestamp }) {
    await this.syncContacts();
    const personalContactSyncInfo = await this._getDataFromStorage(this._personalContactsSyncInfoStorageKey);
    const personalSyncTimestamp = personalContactSyncInfo && personalContactSyncInfo.syncTimestamp;
    const directoryContactsSyncInfo = await this._getDataFromStorage(this._directoryContactsSyncInfoStorageKey);
    const directorySyncTimestamp = directoryContactsSyncInfo && directoryContactsSyncInfo.syncTimestamp;
    const personalContacts = (await this._getDataFromStorage(this._personalContactsStorageKey)) || [];
    const directoryContacts = (await this._getDataFromStorage(this._directoryContactsStorageKey)) || [];
    if (!syncTimestamp) {
      return {
        contacts: directoryContacts.concat(personalContacts),
        syncTimestamp: Date.now(),
      };
    }
    if (syncTimestamp >= personalSyncTimestamp && syncTimestamp >= directorySyncTimestamp) {
      return {
        contacts: [],
        syncTimestamp: Date.now(),
      };
    }
    if (syncTimestamp < personalSyncTimestamp && syncTimestamp >= directorySyncTimestamp) {
      return {
        contacts: personalContacts,
        syncTimestamp: Date.now(),
      };
    }
    if (syncTimestamp >= personalSyncTimestamp && syncTimestamp < directorySyncTimestamp) {
      return {
        contacts: directoryContacts,
        syncTimestamp: Date.now(),
      };
    }
    return {
      contacts: directoryContacts.concat(personalContacts),
      syncTimestamp: Date.now(),
    };
  }

  async searchContacts({ searchString }) {
    const personalContacts = (await this._getDataFromStorage(this._personalContactsStorageKey)) || [];
    const directoryContacts = (await this._getDataFromStorage(this._directoryContactsStorageKey)) || [];
    const contacts = personalContacts.concat(directoryContacts);
    const cleanSearchString = searchString.toLocaleLowerCase();
    const cleanSearchDigit = searchString.replace(/[^\d+]/g, '');
    const result = contacts.filter((c) => {
      const name = c.name.toLocaleLowerCase();
      if (name.indexOf(cleanSearchString) > -1) {
        return true;
      }
      const phoneNumbers = c.phoneNumbers.join('').replace(/[^\d+]/g, '');;
      if (cleanSearchDigit.length > 2 && phoneNumbers.indexOf(cleanSearchDigit) > -1) {
        return true;
      }
      return false;
    });
    return {
      data: result,
    }
  }

  async createCalendarEvent(event) {
    const authorized = await this.checkAuthorize();
    if (!authorized) {
      await this.authorize();
    }
    const eventBody = {
      start: {
        dateTime: event.timeFrom,
      },
      end: {
        dateTime: event.timeTo
      },
      // Title of event, type String
      summary: event.topic,
      // type String
      // location: event.location,
      // type String
      description: event.details,
    };
    const response = await this.fetch({
      url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      body: eventBody,
      method: 'POST',
    })
    return response;
  }

  async getGmails(emailAddresses) {
    let q = emailAddresses.map(ea => `from:${ea} to:${ea}`).join(' ');
    q = `{${q}} newer_than:60d -in:draft -in:chat`;
    const params = {
      maxResults: 5,
      q
    }
    const response = await this.fetch({
      url: 'https://www.googleapis.com/gmail/v1/users/me/threads',
      params,
    })
    const threads = response.threads;
    if (threads === undefined) {
      return [];
    }
    const promises = threads.map(thread =>
      this.fetch({ url: `https://www.googleapis.com/gmail/v1/users/me/threads/${thread.id}` })
    );
    const result = await Promise.all(promises);
    return result.map((thread) => {
      const firstMessage = thread.messages[0];
      let subject = '';
      if (firstMessage && firstMessage.payload && firstMessage.payload.headers) {
        subject = firstMessage.payload.headers.find(header => header.name === 'Subject');
        subject = subject && subject.value ? subject.value : '';
      }
      let time = '';
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (lastMessage && lastMessage.payload && lastMessage.payload.headers) {
        time = lastMessage.payload.headers.find(header => header.name === 'Date');
        time = time && time.value ? time.value : '';
      }
      return { id: thread.id, subject, time };
    });
  }

  getGmailUri(threadId) {
    return `https://mail.google.com/mail/u/${this._userInfo.email}/#inbox/${threadId}`;
  }
}

window.googleClient = new GoogleClient();
