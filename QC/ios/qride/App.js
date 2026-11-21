import React from 'react';
import WebShell from '../shared/WebShell';
// Review build points at the test environment; switch to https://qrides.ca for launch.
export default function App() {
  return <WebShell name="Q RIDE" url="https://qride-review.onrender.com" allowedHost="qride-review.onrender.com" colors={{ bg: '#13294b', fg: '#ffd166' }} needsLocation={true} />;
}
