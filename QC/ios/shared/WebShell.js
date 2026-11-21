// Native shell shared by the Q STAY and Q RIDE iOS apps: loads the web app, keeps users inside
// the app's own domain, shows a native offline screen, pull-to-refresh, and (Q RIDE) native
// location permission so the web map can use the phone's GPS. No secrets live here.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';

export default function WebShell({ url, allowedHost, colors, name, needsLocation }) {
  const web = useRef(null);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const fr = (Intl.DateTimeFormat().resolvedOptions().locale || 'fr').startsWith('fr');

  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)), []);
  useEffect(() => { if (needsLocation) Location.requestForegroundPermissionsAsync().catch(() => {}) }, [needsLocation]);

  const onNav = useCallback((req) => {
    try {
      const u = new URL(req.url);
      if (u.protocol === 'https:' && (u.host === allowedHost || u.host.endsWith('.google.com') || u.host.endsWith('.gstatic.com'))) return true;
      if (['https:', 'http:', 'mailto:', 'tel:', 'sms:'].includes(u.protocol)) { Linking.openURL(req.url); return false; }
    } catch {}
    return false;
  }, [allowedHost]);

  if (!online) {
    return (
      <SafeAreaView style={[s.center, { backgroundColor: colors.bg }]}>
        <Text style={[s.title, { color: colors.fg }]}>{name}</Text>
        <Text style={[s.msg, { color: colors.fg }]}>{fr ? 'Aucune connexion Internet.' : 'No internet connection.'}</Text>
        <Pressable style={[s.btn, { backgroundColor: colors.fg }]} onPress={() => NetInfo.refresh()}>
          <Text style={{ color: colors.bg, fontWeight: '700' }}>{fr ? 'Réessayer' : 'Try again'}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <WebView
        ref={web}
        source={{ uri: url }}
        onShouldStartLoadWithRequest={onNav}
        onLoadEnd={() => setLoading(false)}
        pullToRefreshEnabled
        geolocationEnabled={!!needsLocation}
        sharedCookiesEnabled
        allowsBackForwardNavigationGestures
        applicationNameForUserAgent={`${name.replace(' ', '')}-iOS/1.0`}
        style={{ flex: 1 }}
      />
      {loading && <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: colors.bg }]}><ActivityIndicator color={colors.fg} size="large" /></View>}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '800', marginBottom: 12 },
  msg: { fontSize: 16, marginBottom: 20, opacity: 0.9 },
  btn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
});
