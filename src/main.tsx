// Keep native desktop services out of the Android preview bundle.
const android = location.pathname.startsWith('/android') || new URLSearchParams(location.search).get('platform') === 'android';
void (android ? import('./platforms/android/main') : import('./platforms/desktop/main'));
