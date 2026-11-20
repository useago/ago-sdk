# Browser checks

Run the browser checks with Playwright and Chrome installed:

```sh
node tests/support/background-browser/react-visual-check.mjs
node tests/support/background-browser/vanilla-visual-check.mjs
```

Set `PLAYWRIGHT_MODULE` and `CHROME_PATH` if they are not available by default. Screenshots and results are written to `.context/background-agent-screenshots`; `AGO_SCREENSHOT_DIR` overrides that directory.
