class Background {
  constructor() {
    this._googleClient = new window.GoogleClient();
    this._standalongWindow = null;
    this._addExtensionIconClickedListener();
    this._addStandalongWindowClosedEvent();
    this._initMessageResponseService();
  }

  _addExtensionIconClickedListener() {
    chrome.browserAction.onClicked.addListener((tab) => {
      // open float app window when click icon in office page
      if (this._isFloatingWindowInjected(tab && tab.url)) {
        // send message to content.js to to open app window.
        this.sendMessageToContentAndStandalong({ action: 'openAppWindow' });
        return;
      }
      // open standalong app window when click icon
      if (!this._standalongWindow) {
        chrome.windows.create({
          url: './standalong.html',
          type: 'popup',
          width: 300,
          height: 536
        }, (wind) => {
          this._standalongWindow = wind;
        });
      } else {
        chrome.windows.update(this._standalongWindow.id, {
          focused: true,
        });
      }
    });
  }

  _isFloatingWindowInjected(url) {
    if (!url) {
      return false;
    }
    if (url.indexOf('www.google.com/contacts') > -1) {
      return true;
    }
    if (url.indexOf('calendar.google.com') > -1) {
      return true;
    }
    if (url.indexOf('mail.google.com') > -1) {
      return true;
    }
    return false;
  }

  _addStandalongWindowClosedEvent() {
    chrome.windows.onRemoved.addListener((id) => {
      if (this._standalongWindow && this._standalongWindow.id === id) {
        this._standalongWindow = null;
      }
    });
  }

  _initMessageResponseService() {
    // Listen message from content and standalong to response
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'rc-register-service') {
        this.registerService(sendResponse)
        return true;
      }
      if (request.type === 'rc-post-message-request') {
        if (request.path === '/authorize') {
          this.onAuthorize(request.body.authorized);
          sendResponse({ data: 'ok' });
        }
        if (request.path === '/contacts') {
          this.onGetContacts(request, sendResponse);
        }
        if (request.path === '/conference/invite') {
          this.createCalendarEvent(request, sendResponse);
        }
        if (request.path === '/activities') {
          this.getContactGmails(request, sendResponse);
        }
        if (request.path === '/activity') {
          this.openGmailPage(request, sendResponse);
        }
        if (request.path === '/contacts/search') {
          this.onContactSearch(request, sendResponse);
        }
        if (request.path === '/contacts/match') {
          this.onContactMatch(request, sendResponse);
        }
        return true;
      }
    });
  }

  async sendMessageToContentAndStandalong(message) {
    const key = '__StorageTransportMessageKey';
    await browser.storage.local.set({
      [key]: {
        setter: 'background',
        value: message,
      }
    });
    await browser.storage.local.remove(key);
  }

  async onAuthorize(authorized) {
    if (!authorized) {
      await this._googleClient.authorize();
    } else {
      await this._googleClient.unAuthorize();
    }
    const newAuthorized = await this._googleClient.checkAuthorize();
    if (newAuthorized) {
      this._googleClient.setUserInfo();
      this._googleClient.syncContacts();
    }
    await this.sendMessageToContentAndStandalong(
      { action: 'authorizeStatusChanged', authorized: newAuthorized }
    );
  }

  async onGetContacts(request, sendResponse) {
    const syncTimestamp = request.body.syncTimestamp;
    const response = await this._googleClient.queryContacts({ syncTimestamp });
    sendResponse({
      data: response.contacts,
      syncTimestamp: response.syncTimestamp,
    })
  }

  async onContactSearch(request, sendResponse) {
    const response = await this._googleClient.searchContacts({
      searchString: request.body.searchString,
    });
    sendResponse({
      data: response.data,
    });
  }

  async onContactMatch(request, sendResponse) {
    const response = await this._googleClient.matchContacts({
      phoneNumbers: request.body.phoneNumbers,
    });
    sendResponse({
      data: response.data,
    });
  }

  async registerService(sendResponse) {
    const authorized = await this._googleClient.checkAuthorize();
    sendResponse({
      action: 'registerService',
      service: {
        name: 'Google',
        authorizationPath: '/authorize',
        authorizedTitle: 'Unauthorize',
        unauthorizedTitle: 'Authorize',
        authorized,
        contactsPath: '/contacts',
        contactSearchPath: '/contacts/search',
        contactMatchPath: '/contacts/match',
        conferenceInvitePath: '/conference/invite',
        conferenceInviteTitle: 'Invite with Google Calendar',
        activitiesPath: '/activities',
        activityPath: '/activity'
      }
    });
  }

  async createCalendarEvent(request, sendResponse) {
    const timeFrom = new Date();
    const timeTo = new Date(Date.now()+ 3600 * 1000);
    const event = {
      topic: 'New Conference',
      details: request.body.conference.inviteText,
      timeFrom: timeFrom.toISOString(),
      timeTo: timeTo.toISOString(),
    }
    const response = await this._googleClient.createCalendarEvent(event);
    sendResponse(response);
  }
  
  async getContactGmails(request, sendResponse) {
    if (request.body.contact.emails && request.body.contact.emails.length > 0) {
      const response = await this._googleClient.getGmails(request.body.contact.emails);
      sendResponse({ data: response })
      return;
    }
    sendResponse({ data: [] });
  }
  
  openGmailPage(request, sendResponse) {
    const url = this._googleClient.getGmailUri(request.body.activity.id);
    chrome.windows.create({ url });
    sendResponse({ data: 'ok' });
  }
}

const background = new Background();
