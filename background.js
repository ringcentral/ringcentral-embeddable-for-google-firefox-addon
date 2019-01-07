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

let standalongWindow;
chrome.browserAction.onClicked.addListener(function (tab) {
  // open float app window when click icon in office page
  if (isFloatingWindowInjected(tab && tab.url)) {
    // send message to content.js to to open app window.
    chrome.tabs.sendMessage(tab.id, { action: 'openAppWindow' });
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
  }
  chrome.runtime.sendMessage(
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
  console.log('search', request);
  const response = await window.googleClient.searchContacts({
    searchString: request.body.searchString,
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
    return true;
  }
});
