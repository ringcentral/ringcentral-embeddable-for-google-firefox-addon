console.log('import RingCentral Embeddable Voice to web page');

(function() {
  var rcs = document.createElement("script");
  rcs.src = "https://ringcentral.github.io/ringcentral-embeddable/adapter.js";
  var rcs0 = document.getElementsByTagName("script")[0];
  rcs0.parentNode.insertBefore(rcs, rcs0);
})();

function postMessageToWidget(message) {
  document.querySelector("#rc-widget-adapter-frame").contentWindow.postMessage(message, '*');
}

function responseMessageToWidget(request, response) {
  postMessageToWidget({
    type: 'rc-post-message-response',
    responseId: request.requestId,
    response,
  });
}

function openFloatingWindow() {
  // set app window minimized to false
  window.postMessage({
    type: 'rc-adapter-syncMinimized',
    minimized: false,
  }, '*');
  if (window.document.visibilityState === 'visible') {
    //sync to widget
    postMessageToWidget({
      type: 'rc-adapter-syncMinimized',
      minimized: false,
    });
  }
}

function inviteConference(request) {
  responseMessageToWidget(request, { data: 'ok' });
}

// Listen message from RingCentral Embeddable and response:
var registered = false;
window.addEventListener('message', (e) => {
  const request = e.data;
  if (!request || !request.type) {
    return;
  }
  console.log(request);
  if (request.type === 'rc-adapter-pushAdapterState' && !registered) {
    // To get service info from background and register service
    chrome.runtime.sendMessage({ type: 'rc-register-service' }, function(response) {
      postMessageToWidget({
        type: 'rc-adapter-register-third-party-service',
        service: response.service,
      })
    });
    return;
  }
  chrome.runtime.sendMessage(request, function(response) {
    console.log('response:', response);
    if (request.type === 'rc-post-message-request') {
      if (request.path === '/conference/invite') {
        responseMessageToWidget(request, { data: 'ok' });
        if (response.htmlLink) {
          window.open(response.htmlLink);
        }
        return;
      }
      responseMessageToWidget(request, response)
    }
  });
});

// Listen message from background using storage event
browser.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace != 'local') {
    return;
  }
  const messageData = changes['__StorageTransportMessageKey'];
  if (!messageData || !messageData.newValue) {
    return;
  }
  const { setter, value } = messageData.newValue;
  if (!setter || setter != 'background') {
    return;
  }
  const request = value;
  if (request.action === 'openAppWindow') {
    openFloatingWindow();
  }
  if (request.action === 'authorizeStatusChanged') {
    postMessageToWidget({
      type: 'rc-adapter-update-authorization-status',
      authorized: request.authorized,
    });
  }
});

const clickToDialInject = new window.ClickToDialInject({
  onCallClick: (phoneNumber) => {
    openFloatingWindow();
    postMessageToWidget({
      type: 'rc-adapter-new-call',
      phoneNumber,
      toCall: true,
    });
  },
  onSmsClick: (phoneNumber) => {
    openFloatingWindow();
    postMessageToWidget({
      type: 'rc-adapter-new-sms',
      phoneNumber,
    });
  },
});
