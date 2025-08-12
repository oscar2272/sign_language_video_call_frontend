import { useEffect, useRef } from "react";

export default function CallHistoryPage() {
  // HTMLVideoElement 타입 명시, 초기값 null
  // const videoRef = useRef<HTMLVideoElement | null>(null);

  // useEffect(() => {
  //   async function getMedia() {
  //     try {
  //       const stream = await navigator.mediaDevices.getUserMedia({
  //         video: true,
  //         audio: true,
  //       });
  //       if (videoRef.current) {
  //         videoRef.current.srcObject = stream;
  //       }
  //     } catch (err) {
  //       console.error("Error accessing media devices.", err);
  //     }
  //   }
  //   getMedia();
  // }, []);

  // return (
  //   <div>
  //     <h1>WebRTC 카메라 테스트</h1>
  //     <video
  //       ref={videoRef}
  //       autoPlay
  //       playsInline
  //       muted
  //       style={{ width: "320px", height: "240px", backgroundColor: "black" }}
  //     />
  //   </div>
  <div>test</div>;
}
