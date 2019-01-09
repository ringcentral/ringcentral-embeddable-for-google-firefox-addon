function isFloatingWindowInjected(url) {
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

async function sendMessageToContentAndStandalong(message) {
  const key = '__StorageTransportMessageKey';
  await browser.storage.local.set({
    [key]: {
      setter: 'background',
      value: message,
    }
  });
  await browser.storage.local.remove(key);
}

let standalongWindow;
chrome.browserAction.onClicked.addListener(function (tab) {
  // open float app window when click icon in office page
  if (isFloatingWindowInjected(tab && tab.url)) {
    // send message to content.js to to open app window.
    sendMessageToContentAndStandalong({ action: 'openAppWindow' });
    return;
  }
  // open standalong app window when click icon
  if (!standalongWindow) {
    chrome.windows.create({
      url: './standalong.html',
      type: 'popup',
      width: 300,
      height: 536
    }, function (wind) {
      standalongWindow = wind;
    });
  } else {
    chrome.windows.update(standalongWindow.id, {
      focused: true,
    });
  }
});
chrome.windows.onRemoved.addListener(function (id) {
  if (standalongWindow && standalongWindow.id === id) {
    standalongWindow = null;
  }
});

async function onAuthorize(authorized) {
  if (!authorized) {
    await window.googleClient.authorize();
  } else {
    await window.googleClient.unAuthorize();
  }
  const newAuthorized = await window.googleClient.checkAuthorize();
  if (newAuthorized) {
    window.googleClient.setUserInfo();
    window.googleClient.syncContacts();
  }
  await sendMessageToContentAndStandalong(
    { action: 'authorizeStatusChanged', authorized: newAuthorized }
  );
}

async function onGetContacts(request, sendResponse) {
  const syncTimestamp = request.body.syncTimestamp;
  const response = await window.googleClient.queryContacts({ syncTimestamp });
  sendResponse({
    data: response.contacts,
    syncTimestamp: response.syncTimestamp,
  })
}

async function onContactSearch(request, sendResponse) {
  const response = await window.googleClient.searchContacts({
    searchString: request.body.searchString,
  });
  sendResponse({
    data: response.data,
  });
}

async function onContactMatch(request, sendResponse) {
  const response = await window.googleClient.matchContacts({
    phoneNumbers: request.body.phoneNumbers,
  });
  sendResponse({
    data: response.data,
  });
}

async function registerService(sendResponse) {
  const authorized = await window.googleClient.checkAuthorize();
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

async function createCalendarEvent(request, sendResponse) {
  const timeFrom = new Date();
  const timeTo = new Date(Date.now()+ 3600 * 1000);
  const event = {
    topic: 'New Conference',
    details: request.body.conference.inviteText,
    timeFrom: timeFrom.toISOString(),
    timeTo: timeTo.toISOString(),
  }
  const response = await window.googleClient.createCalendarEvent(event);
  sendResponse(response);
}

async function getContactGmails(request, sendResponse) {
  if (request.body.contact.emails && request.body.contact.emails.length > 0) {
    const response = await window.googleClient.getGmails(request.body.contact.emails);
    sendResponse({ data: response })
    return;
  }
  sendResponse({ data: [] });
}

function openGmailPage(request, sendResponse) {
  const url = window.googleClient.getGmailUri(request.body.activity.id);
  chrome.windows.create({ url });
  sendResponse({ data: 'ok' });
}

// Listen message from content and standalong to response
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === 'rc-register-service') {
    registerService(sendResponse)
    return true;
  }
  if (request.type === 'rc-post-message-request') {
    if (request.path === '/authorize') {
      onAuthorize(request.body.authorized);
      sendResponse({ data: 'ok' });
    }
    if (request.path === '/contacts') {
      onGetContacts(request, sendResponse);
    }
    if (request.path === '/conference/invite') {
      createCalendarEvent(request, sendResponse);
    }
    if (request.path === '/activities') {
      getContactGmails(request, sendResponse);
    }
    if (request.path === '/activity') {
      openGmailPage(request, sendResponse);
    }
    if (request.path === '/contacts/search') {
      onContactSearch(request, sendResponse);
    }
    if (request.path === '/contacts/match') {
      onContactMatch(request, sendResponse);
    }
    return true;
  }
});
