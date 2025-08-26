import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

export const loader = async ({ params }: Route.LoaderArgs) => {
  return { roomId: params.id || null };
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

export default function CallPage({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "calling" | "accepted" | "rejected" | "ended"
  >("calling");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [ended, setEnded] = useState(false);
  const [userId] = useState(() => Math.floor(Math.random() * 10000).toString());

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // WebRTC configuration
  const configuration: RTCConfiguration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  // Initialize WebSocket and WebRTC
  useEffect(() => {
    // Initialize WebSocket
    wsRef.current = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${userId}`
    );

    wsRef.current.onopen = () => {
      console.log("WebSocket connected");
    };

    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      const { type, from_user, sdp, candidate } = data;

      if (type === "call_request") {
        setCallStatus("calling");
      } else if (type === "accepted") {
        setCallStatus("accepted");
        await startCall();
      } else if (type === "rejected" || type === "end_call") {
        setCallStatus(type === "rejected" ? "rejected" : "ended");
        setEnded(true);
        cleanup();
      } else if (type === "offer") {
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(
            new RTCSessionDescription(sdp)
          );
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          wsRef.current?.send(
            JSON.stringify({
              type: "answer",
              sdp: answer,
            })
          );
        }
      } else if (type === "answer") {
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(
            new RTCSessionDescription(sdp)
          );
        }
      } else if (type === "ice") {
        if (pcRef.current && candidate) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
    };

    wsRef.current.onclose = () => {
      console.log("WebSocket closed");
      cleanup();
    };

    // Initialize WebRTC
    pcRef.current = new RTCPeerConnection(configuration);

    pcRef.current.onicecandidate = ({ candidate }) => {
      if (candidate && wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            type: "ice",
            candidate,
          })
        );
      }
    };

    pcRef.current.ontrack = (event) => {
      const [stream] = event.streams;
      setRemoteStream(stream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
    };

    // Get local media stream
    async function getMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        stream.getTracks().forEach((track) => {
          pcRef.current?.addTrack(track, stream);
        });
      } catch (err) {
        console.error("Failed to get media stream:", err);
      }
    }

    getMedia();

    return () => {
      cleanup();
    };
  }, [roomId, userId]);

  // Start call (create offer)
  const startCall = async () => {
    if (pcRef.current && wsRef.current) {
      try {
        const offer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(offer);
        wsRef.current.send(
          JSON.stringify({
            type: "offer",
            sdp: offer,
          })
        );
      } catch (err) {
        console.error("Failed to start call:", err);
      }
    }
  };

  // Toggle camera
  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsCameraOn((prev) => !prev);
    }
  };

  // End call
  const endCall = async () => {
    if (wsRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: "end_call",
        })
      );
    }
    setCallStatus("ended");
    setEnded(true);
    cleanup();

    try {
      await fetch(`${CALL_API_URL}/end/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: roomId,
        }),
      });
    } catch (err) {
      console.error("Failed to end call:", err);
    }
  };

  // Cleanup resources
  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      setRemoteStream(null);
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  return (
    <div className="flex flex-col items-center h-screen bg-gray-100 p-4">
      <div className="flex flex-col md:flex-row gap-4 w-full max-w-4xl">
        {/* Remote Video */}
        <div className="flex-1 bg-black rounded-lg overflow-hidden">
          {remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white">
              {callStatus === "calling" && "Calling..."}
              {callStatus === "rejected" && "Call Rejected"}
              {callStatus === "ended" && "Call Ended"}
            </div>
          )}
        </div>
        {/* Local Video */}
        <div className="w-full md:w-1/3 bg-black rounded-lg overflow-hidden">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      </div>
      <div className="flex gap-4 mt-4">
        <Button
          onClick={toggleCamera}
          variant={isCameraOn ? "default" : "secondary"}
          className="px-4 py-2"
        >
          {isCameraOn ? "Turn Camera Off" : "Turn Camera On"}
        </Button>
        <Button
          onClick={endCall}
          variant="destructive"
          className="px-4 py-2"
          disabled={ended}
        >
          End Call
        </Button>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        Status: {callStatus.charAt(0).toUpperCase() + callStatus.slice(1)}
      </p>
    </div>
  );
}
