import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedLoginUrl, openInstagramLoginWindow, type LoginWindowLike } from "./instagram-login-window.ts";

const REDIRECT = "https://www.facebook.com/connect/login_success.html";

/** A window whose navigation and closing this test drives directly. */
function fakeWindow() {
  let navigate: (url: string) => void = () => {};
  let closed: () => void = () => {};
  const state = { loaded: "", closeCalls: 0 };
  const window: LoginWindowLike = {
    loadURL: (url) => { state.loaded = url; },
    onNavigate: (listener) => { navigate = listener; },
    onClosed: (listener) => { closed = listener; },
    close: () => { state.closeCalls += 1; closed(); },
  };
  return { window, state, navigate: (url: string) => navigate(url), userCloses: () => closed() };
}

test("loads the login page it was given", async () => {
  const { window, state } = fakeWindow();
  void openInstagramLoginWindow("https://www.facebook.com/v26.0/dialog/oauth?x=1", REDIRECT, { createWindow: () => window });
  assert.equal(state.loaded, "https://www.facebook.com/v26.0/dialog/oauth?x=1");
});

test("resolves with the whole redirect URL, unparsed, and closes the window", async () => {
  const fake = fakeWindow();
  const result = openInstagramLoginWindow("https://www.facebook.com/login", REDIRECT, { createWindow: () => fake.window });
  fake.navigate(`${REDIRECT}?code=the-code&state=the-state`);
  assert.deepEqual(await result, { kind: "redirected", url: `${REDIRECT}?code=the-code&state=the-state` });
  assert.equal(fake.state.closeCalls, 1);
});

test("ignores the pages the login walks through on the way", async () => {
  const fake = fakeWindow();
  const result = openInstagramLoginWindow("https://www.facebook.com/login", REDIRECT, { createWindow: () => fake.window });
  fake.navigate("https://www.facebook.com/login.php?next=whatever");
  fake.navigate("https://www.facebook.com/checkpoint/");
  assert.equal(fake.state.closeCalls, 0);
  fake.navigate(`${REDIRECT}?code=c&state=s`);
  assert.equal((await result).kind, "redirected");
});

test("reports a closed window as cancelled, which is an answer and not a failure", async () => {
  const fake = fakeWindow();
  const result = openInstagramLoginWindow("https://www.facebook.com/login", REDIRECT, { createWindow: () => fake.window });
  fake.userCloses();
  assert.deepEqual(await result, { kind: "cancelled" });
});

test("does not turn a successful login into a cancellation when its own close fires", async () => {
  // close() triggers onClosed; without guarding, that second settle would overwrite the redirect result.
  const fake = fakeWindow();
  const result = openInstagramLoginWindow("https://www.facebook.com/login", REDIRECT, { createWindow: () => fake.window });
  fake.navigate(`${REDIRECT}?code=c&state=s`);
  assert.equal((await result).kind, "redirected");
});

test("ignores navigation that arrives after the window was closed", async () => {
  const fake = fakeWindow();
  const result = openInstagramLoginWindow("https://www.facebook.com/login", REDIRECT, { createWindow: () => fake.window });
  fake.userCloses();
  fake.navigate(`${REDIRECT}?code=too-late&state=s`);
  assert.deepEqual(await result, { kind: "cancelled" });
});

test("allows only https Facebook login pages", () => {
  assert.equal(isAllowedLoginUrl("https://www.facebook.com/v26.0/dialog/oauth?x=1"), true);
  assert.equal(isAllowedLoginUrl("https://facebook.com/dialog/oauth"), true);
  assert.equal(isAllowedLoginUrl("http://www.facebook.com/dialog/oauth"), false);
  assert.equal(isAllowedLoginUrl("https://evil.example.com/dialog/oauth"), false);
  // A lookalike host that merely ends with the real one must not pass.
  assert.equal(isAllowedLoginUrl("https://notfacebook.com/dialog/oauth"), false);
  assert.equal(isAllowedLoginUrl("https://www.facebook.com.evil.example/dialog"), false);
  assert.equal(isAllowedLoginUrl("not a url"), false);
});
