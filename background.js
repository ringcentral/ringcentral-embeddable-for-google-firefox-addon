class Background {
  constructor() {
    this._googleClient = new window.GoogleClient();
    this._standalongWindow = null;
    this._messagesToStandalong = [];  // message queue of standalong
    this._widgetTabs = {};
    this._notificationIds = {};
    this._addExtensionIconClickedListener();
    this._addStandalongWindowClosedEvent();
    this._initMessageResponseService();
    this._initClientConnectedListener();
    this._initNotificationListener();
  }

  _addExtensionIconClickedListener() {
    browser.browserAction.onClicked.addListener((tab) => {
      // open float app window when click icon in office page
      if (this._isFloatingWindowInjected(tab && tab.url)) {
        // send message to content.js to to open app window.
        this.sendMessageToContentAndStandalong({ action: 'openAppWindow' });
        return;
      }
      // open standalong app window when click icon
      this.openStandalongWindow();
    });
  }

  _initClientConnectedListener() {
    browser.runtime.onConnect.addListener((port) => {
      this._widgetTabs[port.sender.tab.id] = 1;
      port.onDisconnect.addListener(() => {
        delete this._widgetTabs[port.sender.tab.id]
      });
    });
  }

  async openStandalongWindow() {
    if (!this._standalongWindow) {
      const wind = await browser.windows.create({
        url: './standalong.html',
        type: 'popup',
        width: 300,
        height: 536
      });
      this._standalongWindow = wind;
    } else {
      await browser.windows.update(this._standalongWindow.id, {
        focused: true,
      });
    }
  }

  _isFloatingWindowInjected(url) {
    if (!url) {
      return false;
    }
    if (url.indexOf('www.google.com/contacts') > -1) {
      return true;
    }
    if (url.indexOf('contacts.google.com') > -1) {
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
        if (request.from === 'standalong') {
          // send messages to standalong when it opened and inited
          this._sendMessagesQueueToStandalong();
        }
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
      if (request.type === 'rc-adapter-to-standalong') {
        this.sendMessagesToStandalong(request.data);
      }
      if (request.type === 'rc-adapter-open-standalong') {
        this.openStandalongWindow();
      }
      if (request.type === 'rc-adapter-get-widget-tabs') {
        sendResponse({ data: this._widgetTabs });
      }
      if (request.type === 'rc-active-call-notify') {
        this.createNoticiation(request.call);
      }
      console.log(request);
    });
  }

  _sendMessagesQueueToStandalong() {
    if (this._messagesToStandalong.length > 0) {
      const messages = this._messagesToStandalong;
      this._messagesToStandalong = [];
      messages.forEach((message) => {
        this.sendMessageToStandalong(message);
      });
    }
  }

  async sendMessagesToStandalong(request) {
    const command = {
      action: 'messageToWidget',
      data: request,
    };
    if (this._standalongWindow) {
      this.sendMessageToStandalong(command);
      return;
    }
    this._messagesToStandalong.push(command);
    await this.openStandalongWindow();
  }

  async sendMessageToContentAndStandalong(message) {
    const key = '__StorageTransportMessageKey';
    await browser.storage.local.set({
      [key]: {
        setter: 'backgroundBroadcast',
        value: message,
      }
    });
    await browser.storage.local.remove(key);
  }

  async sendMessageToStandalong(message) {
    const key = '__StorageTransportMessageKey';
    await browser.storage.local.set({
      [key]: {
        setter: 'backgroundToStandalong',
        value: message,
      }
    });
    await browser.storage.local.remove(key);
  }

  async createNoticiation(call) {
    if (call.telephonyStatus !== 'Ringing' || call.direction !== 'Inbound') {
      return;
    }
    if (this._notificationIds[call.sessionId]) {
      return;
    }
    this._notificationIds[call.sessionId] = Date.now();
    browser.notifications.create(
      call.sessionId,
      {
        type: 'basic',
        title: 'New Call',
        message: `Call from: ${call.from && call.from.phoneNumber}`
      }
    )
  }

  _initNotificationListener() {
    browser.notifications.onClosed.addListener((notificationId) => {
      delete this._notificationIds[notificationId];
    });
    browser.notifications.onClicked.addListener((notificationId) => {
      if (this._standalongWindow) {
        this.openStandalongWindow();
        return;
      }
      delete this._notificationIds[notificationId];
      if (Object.keys(this._widgetTabs).length > 0) {
        const lastTabId = Object.keys(this._widgetTabs)[Object.keys(this._widgetTabs).length - 1];
        browser.tabs.update(parseInt(lastTabId), { active: true });
        return;
      }
    });
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
