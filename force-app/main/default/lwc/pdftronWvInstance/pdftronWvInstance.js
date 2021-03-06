import { LightningElement, wire, track, api } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { loadScript } from 'lightning/platformResourceLoader';
import libUrl from '@salesforce/resourceUrl/lib';
import myfilesUrl from '@salesforce/resourceUrl/myfiles';
import { publish, createMessageContext, releaseMessageContext, subscribe, unsubscribe } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import mimeTypes from './mimeTypes'
import lmsWebviewer from "@salesforce/messageChannel/LMSWebViewer__c";
import { registerListener, unregisterAllListeners } from 'c/pubsub';
import getFirstAttachment from "@salesforce/apex/PDFTron_ContentVersionController.getFirstAttachment";
import saveDocument from '@salesforce/apex/PDFTron_ContentVersionController.saveDocument';

function _base64ToArrayBuffer(base64) {
  var binary_string = window.atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export default class PdftronWvInstance extends LightningElement {
  @track receivedMessage = '';
  channel;
  context = createMessageContext();

  source = 'My file';
  fullAPI = true;
  @api recordId;

  @wire(CurrentPageReference)
  pageRef;

  constructor() {
    super();
  }

  connectedCallback() {
    registerListener('blobSelected', this.handleBlobSelected, this);
    window.addEventListener('message', this.handleReceiveMessage.bind(this), false);
    this.handleSubscribe();
  }

  disconnectedCallback() {
    unregisterAllListeners(this);
    window.removeEventListener('message', this.handleReceiveMessage, true);
    releaseMessageContext(this.context);
    this.handleUnsubscribe();
  }

  handleSubscribe() {
    const parentPage = this;
    this.channel = subscribe(this.context, lmsWebviewer, (event) => {
      if (event != null) {
        //handle date within LWC
        const message = event.messageBody;
        const source = event.source;
        parentPage.receivedMessage = 'Links to be loaded: ' + message + '\nSent From: ' + source;

        const payload = {
          message: event.messageBody,
          filename: event.filename,
          source: event.source
        }

        //post data to WebViewer iframe
        parentPage.iframeWindow.postMessage({ type: 'LMS_RECEIVED', payload }, '*');
      }
    });
  }

  handleUnsubscribe() {
    unsubscribe(this.channel);
  }

  handleBlobSelected(record) {
    record = JSON.parse(record);

    var blobby = new Blob([_base64ToArrayBuffer(record.body)], {
      type: mimeTypes[record.FileExtension]
    });

    const payload = {
      blob: blobby,
      extension: record.cv.FileExtension,
      filename: record.cv.Title + "." + record.cv.FileExtension,
      documentId: record.cv.Id
    };
    this.iframeWindow.postMessage({ type: 'OPEN_DOCUMENT_BLOB', payload }, '*');
  }

  renderedCallback() {
    var self = this;
    if (this.uiInitialized) {
      return;
    }
    this.uiInitialized = true;

    Promise.all([
      loadScript(self, libUrl + '/webviewer.min.js')
    ])
      .then(() => this.initUI())
      .catch(console.error);
  }

  initUI() {
    var myObj = {
      libUrl: libUrl,
      fullAPI: this.fullAPI || false,
      namespacePrefix: '',
    };
    var url = myfilesUrl + '/webviewer-demo-annotated.pdf';

    const viewerElement = this.template.querySelector('div')
    // eslint-disable-next-line no-unused-vars
    const viewer = new WebViewer({
      path: libUrl, // path to the PDFTron 'lib' folder on your server
      custom: JSON.stringify(myObj),
      backendType: 'ems',
      config: myfilesUrl + '/config_apex.js',
      fullAPI: this.fullAPI,
      enableFilePicker: this.enableFilePicker,
      enableRedaction: this.enableRedaction,
      enableMeasurement: this.enableMeasurement,
      // l: 'YOUR_LICENSE_KEY_HERE',
    }, viewerElement);

    viewerElement.addEventListener('ready', () => {
      this.iframeWindow = viewerElement.querySelector('iframe').contentWindow;

      getFirstAttachment({fundEventId: this.recordId})
      .then((result) => {
        console.log('result', result);
        if(result.body) {
          var blobby = new Blob([_base64ToArrayBuffer(result.body)], {
            type: mimeTypes[result.extension]
          });
        }
        let fExtension = result.extension;
        if(fExtension.charAt(0) === '.'){
          fExtension = fExtension.substring(1);
        }

          const payload = {
            linkblob: result.s3link ? result.s3link : blobby,
            extension: fExtension,
            filename: result.name,
            documentId: result.Id
          };
          this.iframeWindow.postMessage({ type: 'OPEN_BLOB_OR_LINK', payload }, '*');
      })
      .catch(error => {
        console.error(error);
      });
    })
  }

  handleReceiveMessage(event) {
    const me = this;
    if (event.isTrusted && typeof event.data === 'object') {
      switch (event.data.type) {
        case 'SAVE_DOCUMENT':
          saveDocument({ json: JSON.stringify(event.data.payload), recordId: this.recordId }).then((response) => {
            me.iframeWindow.postMessage({ type: 'DOCUMENT_SAVED', response }, '*')
          }).catch(error => {
            console.error(JSON.stringify(error));
          });
          break;
        case 'TAB_ACTIVE':
            me.iframeWindow.postMessage({ type: 'DOCUMENT_SAVED', response }, '*');
          break;
        default:
          break;
      }
    }
  }

  @api
  openDocument() {
  }

  @api
  closeDocument() {
    this.iframeWindow.postMessage({ type: 'CLOSE_DOCUMENT' }, '*')
  }
}