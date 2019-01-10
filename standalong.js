console.log('from standalong.js');

class StandalongClient {
  constructor() {
    this._registered = false;

    this._initWidgetMessageListener();
    this._initBackgroundMessageListener();
  }

  // Listen message from RingCentral Embeddable and response:
  _initWidgetMessageListener() {
    window.addEventListener('message', (e) => {
      const request = e.data;
      if (!request || !request.type) {
        return;
      }
      console.log(request);
      if (request.type === 'rc-adapter-pushAdapterState' && !this._registered) {
        this._registered = true;
        // To register service
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
      if (request.action === 'authorizeStatusChanged') {
        this.postMessageToWidget({
          type: 'rc-adapter-update-authorization-status',
          authorized: request.authorized,
        });
      }
    });
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

window.client = new StandalongClient();
