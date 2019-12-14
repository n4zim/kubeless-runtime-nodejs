
## Runtime Images
```json
{
  "ID": "nodejs",
  "depName": "package.json",
  "fileNameSuffix": ".js",
  "versions": [
    {
      "name": "nodejs13",
      "version": "13",
      "images": [
        {
          "phase": "installation",
          "image": "n4zim/kubeless-runtime:nodejs13@sha256:[! INSERT LATEST HASH !]",
          "command": "kiwi install"
        },
        {
          "phase": "runtime",
          "image": "n4zim/kubeless-runtime:nodejs13@sha256:[! INSERT LATEST HASH !]",
          "env": {
            "NODE_PATH": "$(KUBELESS_INSTALL_VOLUME)/node_modules"
          }
        }
      ]
    }
  ]
}
```
