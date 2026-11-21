import React from 'react';
import WebShell from '../shared/WebShell';
// Review build points at the test environment; switch to https://qstay.ca for launch.
export default function App() {
  return <WebShell name="Q STAY" url="https://qstay-review.onrender.com" allowedHost="qstay-review.onrender.com" colors={{ bg: '#215b44', fg: '#e7f2c6' }} needsLocation={false} />;
}
