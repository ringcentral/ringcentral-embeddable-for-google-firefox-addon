const GOOGLE_CLIENT_ID = 'GOOGLE_CLIENT_ID';
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
    this._tokenStorageKey = '__googleClient.token';
    this._init();
  }

  async _init() {
    if (!this._getTokenPromise) {
      this._getTokenPromise = this.getToken();
    }
    await this._getTokenPromise;
    this._getTokenPromise = null;
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
      await browser.storage.local.set({
        [this._tokenStorageKey]: this._token,
      });
      console.log('Authorize with google successfully.');
      this.setUserInfo();
    } catch (e) {
      this._token = {};
      console.error('Authorize with google failed.', e);
    }
  }

  async unAuthorize() {
    const token = this._token.accessToken;
    this._token = {};
    await browser.storage.local.set({
      [this._tokenStorageKey]: {},
    });
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
      url: 'https://www.googleapis.com/plus/v1/people/me',
    });
    if (response.emails && response.emails.length > 0) {
      const primaryEmail = response.emails.find(email => email.type === 'account');
      if (primaryEmail) {
        this._userInfo = {
          ...response,
          email: primaryEmail.value,
        };
      }
    }
  }

  async queryContacts({ pageToken, syncToken } = {}) {
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
    })
    console.log(result);
    return result;
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
