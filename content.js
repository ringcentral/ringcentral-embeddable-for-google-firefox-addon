console.log('import RingCentral Embeddable Voice to web page');

class ContentClient {
  constructor() {
    this._registered = false;
    this._injectWidget();
    this._initWidgetMessageListener();
    this._initBackgroundMessageListener();
    this._initC2DInject();
  }

  _injectWidget() {
    (function() {
      var rcs = document.createElement("script");
      rcs.src = "https://ringcentral.github.io/ringcentral-embeddable/adapter.js";
      var rcs0 = document.getElementsByTagName("script")[0];
      rcs0.parentNode.insertBefore(rcs, rcs0);
    })();
  }

  _initWidgetMessageListener() {
    // Listen message from RingCentral Embeddable widget and response:
    window.addEventListener('message', (e) => {
      const request = e.data;
      if (!request || !request.type) {
        return;
      }
      console.log(request);
      if (request.type === 'rc-adapter-pushAdapterState' && !this._registered) {
        this._registered = true;
        // To get service info from background and register service
        chrome.runtime.sendMessage({ type: 'rc-register-service' }, (response) => {
          this.postMessageToWidget({
            type: 'rc-adapter-register-third-party-service',
            service: response.service,
          })
        });
        return;
      }
      // pass widget message to background
      chrome.runtime.sendMessage(request, (response) => {
        console.log('response:', response);
        if (request.type === 'rc-post-message-request') {
          if (request.path === '/conference/invite') {
            this.responseMessageToWidget(request, { data: 'ok' });
            if (response.htmlLink) {
              window.open(response.htmlLink);
            }
            return;
          }
          // pass background message to widget
          this.responseMessageToWidget(request, response)
        }
      });
    });
  }

  _initBackgroundMessageListener() {
    // Listen message from background using storage event
    browser.storage.onChanged.addListener((changes, namespace) => {
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
        this.openFloatingWindow();
      }
      if (request.action === 'authorizeStatusChanged') {
        this.postMessageToWidget({
          type: 'rc-adapter-update-authorization-status',
          authorized: request.authorized,
        });
      }
    });
  }

  _initC2DInject() {
    this._clickToDialInject = new window.ClickToDialInject({
      onCallClick: (phoneNumber) => {
        this.openFloatingWindow();
        this.postMessageToWidget({
          type: 'rc-adapter-new-call',
          phoneNumber,
          toCall: true,
        });
      },
      onSmsClick: (phoneNumber) => {
        this.openFloatingWindow();
        this.postMessageToWidget({
          type: 'rc-adapter-new-sms',
          phoneNumber,
        });
      },
    });
  }

  openFloatingWindow() {
    // set app window minimized to false
    window.postMessage({
      type: 'rc-adapter-syncMinimized',
      minimized: false,
    }, '*');
    if (window.document.visibilityState === 'visible') {
      //sync to widget
      this.postMessageToWidget({
        type: 'rc-adapter-syncMinimized',
        minimized: false,
      });
    }
  }

  postMessageToWidget(message) {
    document.querySelector("#rc-widget-adapter-frame").contentWindow.postMessage(message, '*');
  }
  
  responseMessageToWidget(request, response) {
    this.postMessageToWidget({
      type: 'rc-post-message-response',
      responseId: request.requestId,
      response,
    });
  }
}

window.client = new ContentClient();
