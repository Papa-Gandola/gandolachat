// Web stub for react-native-webrtc.
//
// The browser exposes WebRTC natively, so we map the library's named exports
// onto the standard DOM APIs. RTCView (a native RN SurfaceView on mobile) is
// replaced with a <video> element bound to the MediaStream via srcObject.
//
// Only loaded for the web bundle (aliased in metro.config.js). Native iOS /
// Android builds use the real package and never see this file.
import React from "react";

const G = typeof globalThis !== "undefined" ? globalThis : window;

export const RTCPeerConnection = G.RTCPeerConnection;
export const RTCIceCandidate = G.RTCIceCandidate;
export const RTCSessionDescription = G.RTCSessionDescription;
export const MediaStream = G.MediaStream;
export const mediaDevices = G.navigator ? G.navigator.mediaDevices : undefined;

// react-native-webrtc lets you call `stream.toURL()` and feed the result to
// RTCView's `streamURL`. The browser MediaStream has no toURL(), so we shim it
// to return the stream itself and have RTCView assign whatever it receives to
// the <video>'s srcObject.
if (MediaStream && MediaStream.prototype && !MediaStream.prototype.toURL) {
  // eslint-disable-next-line no-extend-native
  MediaStream.prototype.toURL = function () {
    return this;
  };
}

// Flatten an RN style (object | array | nested arrays) to a plain CSS object.
function flattenStyle(style) {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return style;
}

export function RTCView(props) {
  const { streamURL, objectFit, mirror, style, zOrder, ...rest } = props || {};
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current && streamURL) {
      // streamURL is actually the MediaStream (see the toURL shim above).
      try {
        ref.current.srcObject = streamURL;
      } catch (e) {
        /* ignore — element may have unmounted */
      }
    }
  }, [streamURL]);
  const domStyle = {
    width: "100%",
    height: "100%",
    ...(objectFit ? { objectFit } : null),
    ...(mirror ? { transform: "scaleX(-1)" } : null),
    ...flattenStyle(style),
  };
  return React.createElement("video", {
    ref,
    autoPlay: true,
    playsInline: true,
    // Mute only the local (mirrored) preview to avoid echo; remote streams
    // must play their audio.
    muted: !!mirror,
    style: domStyle,
    ...rest,
  });
}

export default {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
  mediaDevices,
  RTCView,
};
