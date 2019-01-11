# RingCentral Embeddable for Google with Firefox add-ons

![Google Contacts With RingCentral Embeddable](https://user-images.githubusercontent.com/7036536/51007549-e5645380-1582-11e9-88a6-4c9ada1681fc.png)

## Features

- [x] Integrate Google feature with Google Authorization
- [x] Integrate Google Contacts
- [x] Integrate Google Directory
- [x] Integrate Google Calendar
- [x] Integrate Google Gmail
- [x] Click to Dial and SMS in google related pages
- [ ] Desktop Notification
- [ ] Limit floating window count

## Releases

Please get all releases in [Releases page](https://github.com/embbnux/ringcentral-embeddable-for-google-firefox-addon/releases)


## Development

```
git clone https://github.com/embbnux/ringcentral-embeddable-for-google-firefox-addon.git
```

1. Add google client id in googleClient file. Need  to add `People, Google Plus, Gmail. Calendar, and Admin SDK ` scope in google developer console. `Admin SDK` is for directory api.
1. Go to Firefox add-ons page `about:debugging#addons`.
2. Load Temporary Add-on and select this project's `manifest.json`
3. Go to `https://www.google.com/contacts/#contacts` to check
