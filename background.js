let newWindow;
chrome.browserAction.onClicked.addListener(function (tab) {
  // open float app window when click icon in office page
  if (tab && tab.url && tab.url.indexOf('google.com') > -1) {
    // send message to content.js to to open app window.
    chrome.tabs.sendMessage(tab.id, { action: 'openAppWindow' }, function(response) {
      console.log(response);
    });
    return;
  }
  // open standalong app window when click icon
  if (!newWindow) {
    chrome.windows.create({
      url: './standalong.html',
      type: 'popup',
      width: 300,
      height: 536
    }, function (wind) {
      newWindow = wind;
    });
  } else {
    chrome.windows.update(newWindow.id, {
      focused: true,
    });
  }
});
chrome.windows.onRemoved.addListener(function (id) {
  if (newWindow && newWindow.id === id) {
    newWindow = null;
  }
});

async function onAuthorize(authorized) {
  if (!authorized) {
    await window.googleClient.authorize();
  } else {
    await window.googleClient.unAuthorize();
  }
  const newAuthorized = await window.googleClient.checkAuthorize();
  chrome.runtime.sendMessage(
    { action: 'authorizeStatusChanged', authorized: newAuthorized }
  );
}

async function onGetContacts(request, sendResponse) {
  const pageToken = request.body.page === 1 ? null : request.body.page;
  const syncToken = request.body.syncTimestamp;
  const response = await window.googleClient.queryContacts({ pageToken, syncToken });
  const contacts = response.connections || [];
  sendResponse({
    data: contacts.map((c) => ({
      id: c.resourceName.replace('people/', ''),
      name: c.names[0] && c.names[0].displayName,
      type: 'Google', // need to same as service name
      phoneNumbers:
        (c.phoneNumbers && c.phoneNumbers.map(p => ({ phoneNumber: p.value, phoneType: p.type }))) ||
        [],
      emails: (c.emailAddresses && c.emailAddresses.map(c => c.value)) || [],
    })),
    nextPage: response.nextPageToken,
    syncTimestamp: response.nextSyncToken,
  })
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
    return true;
  }
});
