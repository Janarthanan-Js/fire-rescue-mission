package com.firerescuemission.game;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Fire Rescue Mission - Android WebView shell.
 *
 * The game (HTML5 Canvas + Web Audio) ships inside the APK under assets/www and is
 * served over a virtual HTTPS origin (https://appassets.androidplatform.net) so the
 * page runs in a SECURE context. That matters: without a secure origin, localStorage
 * (save games) and Web Audio would be blocked or unreliable.
 *
 * Asset serving is implemented with plain framework APIs (no androidx dependency) via
 * WebViewClient#shouldInterceptRequest.
 *
 * BUILD NOTE: every helper below is a *static* nested class with explicitly injected
 * dependencies. This is required by the Android build-tools r34 d8 (R8 8.2.2-dev)
 * shipped for this build: it throws an internal NullPointerException
 * ("String.length() because <parameter1> is null") when it dexes any class that has a
 * synthetic outer-instance field (this$0) - i.e. non-static inner classes and
 * anonymous classes. Static nested classes are dexed fine. Do not convert these back
 * to inner/anonymous classes without re-testing dex.
 */
public class GameActivity extends Activity {

    static final String ASSET_HOST = "appassets.androidplatform.net";
    static final String ASSET_PREFIX = "/assets/www/";
    static final String START_URL = "https://" + ASSET_HOST + ASSET_PREFIX + "index.html";

    static final long DOUBLE_BACK_MS = 2000L;

    private WebView webView;
    private long lastBackPress = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enableImmersive();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#10131c"));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new LocalAssetClient(this));
        webView.setWebChromeClient(new ConsoleSink());

        setContentView(webView);
        webView.loadUrl(START_URL);
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onPause() {
        // The game auto-pauses on window blur; fire blur so a backgrounded app pauses.
        safeJs("try{window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('blur'));}catch(e){}");
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        enableImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enableImmersive();
    }

    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBackPress < DOUBLE_BACK_MS) {
            super.onBackPressed();
            return;
        }
        lastBackPress = now;
        // Let the game react to Back (e.g. open its pause menu) before we ever exit.
        safeJs("try{if(window.App&&App.onAndroidBack){App.onAndroidBack();}else{window.dispatchEvent(new Event('blur'));}}catch(e){}");
        Toast.makeText(this, "Press Back again to exit", Toast.LENGTH_SHORT).show();
    }

    // ------------------------------------------------------------------ helpers

    private void safeJs(String js) {
        if (webView == null) return;
        try {
            webView.post(new JsRunner(webView, js));
        } catch (Throwable ignored) { }
    }

    private void enableImmersive() {
        // Legacy immersive flags: functional on every supported API level (24+).
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    // ------------------------------------------------------------------ static nested helpers

    /** Runs a snippet of JS on the UI thread. Static: no synthetic this$0 (see BUILD NOTE). */
    private static final class JsRunner implements Runnable {
        private final WebView wv;
        private final String js;

        JsRunner(WebView wv, String js) {
            this.wv = wv;
            this.js = js;
        }

        @Override
        public void run() {
            try { wv.evaluateJavascript(js, null); } catch (Throwable ignored) { }
        }
    }

    /** Consumes (hides) WebView console output. */
    private static final class ConsoleSink extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage cm) {
            return true;
        }
    }

    static final class Mime {
        static String of(String path) {
            String p = path.toLowerCase();
            int dot = p.lastIndexOf('.');
            String ext = dot >= 0 ? p.substring(dot + 1) : "";
            if (ext.equals("html") || ext.equals("htm")) return "text/html";
            if (ext.equals("js") || ext.equals("mjs")) return "application/javascript";
            if (ext.equals("css")) return "text/css";
            if (ext.equals("json")) return "application/json";
            if (ext.equals("png")) return "image/png";
            if (ext.equals("jpg") || ext.equals("jpeg")) return "image/jpeg";
            if (ext.equals("gif")) return "image/gif";
            if (ext.equals("webp")) return "image/webp";
            if (ext.equals("svg")) return "image/svg+xml";
            if (ext.equals("ico")) return "image/x-icon";
            if (ext.equals("woff2")) return "font/woff2";
            if (ext.equals("woff")) return "font/woff";
            if (ext.equals("ttf")) return "font/ttf";
            if (ext.equals("otf")) return "font/otf";
            if (ext.equals("mp3")) return "audio/mpeg";
            if (ext.equals("ogg")) return "audio/ogg";
            if (ext.equals("wav")) return "audio/wav";
            if (ext.equals("txt")) return "text/plain";
            return "application/octet-stream";
        }

        static boolean isText(String mime) {
            return mime.startsWith("text/")
                    || mime.equals("application/javascript")
                    || mime.equals("application/json")
                    || mime.equals("image/svg+xml");
        }
    }

    /** Serves assets/www over the virtual https origin. Static: no this$0 (see BUILD NOTE). */
    static final class LocalAssetClient extends WebViewClient {

        private final Context ctx;

        LocalAssetClient(Context ctx) {
            this.ctx = ctx;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                Uri uri = request.getUrl();
                if (uri == null) return null;
                String host = uri.getHost();
                if (host == null || !ASSET_HOST.equals(host)) return null; // let anything else fall through

                String path = uri.getPath();
                if (path == null) return null;
                if (path.equals("/assets/www") || path.equals("/assets/www/")) {
                    path = ASSET_PREFIX + "index.html";
                }
                if (!path.startsWith(ASSET_PREFIX)) return null;

                String rel = path.substring(ASSET_PREFIX.length());
                if (rel.length() == 0) rel = "index.html";
                return serveAsset(rel);
            } catch (Throwable t) {
                return null;
            }
        }

        private WebResourceResponse serveAsset(String rel) {
            InputStream in = null;
            try {
                in = ctx.getAssets().open("www/" + rel);
                String mime = Mime.of(rel);
                String enc = Mime.isText(mime) ? "UTF-8" : "binary";
                WebResourceResponse r = new WebResourceResponse(mime, enc, in);
                Map<String, String> headers = new HashMap<String, String>();
                headers.put("Cache-Control", "no-cache");
                r.setResponseHeaders(headers);
                return r;
            } catch (IOException e) {
                if (in != null) { try { in.close(); } catch (IOException ignored) { } }
                byte[] body = ("Not found: " + rel).getBytes();
                WebResourceResponse missing =
                        new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(body));
                missing.setStatusCodeAndReasonPhrase(404, "Not Found");
                return missing;
            }
        }
    }
}
