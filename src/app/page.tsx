"use client";

import { useRef, useState, useEffect, useCallback } from "react";

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const chunks = useRef<Blob[]>([]);
  
  // Add refs to track previous mouth positions and speaking status
  const prevMouthPositions = useRef<Map<number, any[]>>(new Map());
  const speakingFaces = useRef<Map<number, boolean>>(new Map());
  const frameCounter = useRef<number>(0);
  // Add debounce counters for each face
  const speakingCounters = useRef<Map<number, number>>(new Map());
  const notSpeakingCounters = useRef<Map<number, number>>(new Map());
  
  // Add zoom-related state
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const currentZoomFace = useRef<number | null>(null);
  const zoomTransition = useRef<{
    progress: number;
    targetX: number;
    targetY: number;
    targetScale: number;
    startX: number;
    startY: number;
    startScale: number;
  }>({
    progress: 0,
    targetX: 0,
    targetY: 0,
    targetScale: 1,
    startX: 0,
    startY: 0,
    startScale: 1,
  });
  const facePositions = useRef<Map<number, {x: number, y: number, width: number, height: number}>>(new Map());

  // Helper function to calculate mouth movement
  const calculateMouthMovement = (currentLandmarks: any[], previousLandmarks: any[]) => {
    if (!previousLandmarks || previousLandmarks.length === 0) return 0;
    
    // Focus specifically on mouth opening/closing landmarks
    // Upper lip: 13, 14, 312
    // Lower lip: 17, 15, 16
    // Corners: 61, 291
    const upperLipIndices = [13, 14, 312];
    const lowerLipIndices = [17, 15, 16];
    const cornerIndices = [61, 291];
    
    // Calculate vertical distance between upper and lower lip
    let verticalMovement = 0;
    
    // Get average positions of upper and lower lip
    let upperLipY = 0;
    let lowerLipY = 0;
    
    upperLipIndices.forEach(index => {
      if (currentLandmarks[index]) {
        upperLipY += currentLandmarks[index].y;
      }
    });
    upperLipY /= upperLipIndices.length;
    
    lowerLipIndices.forEach(index => {
      if (currentLandmarks[index]) {
        lowerLipY += currentLandmarks[index].y;
      }
    });
    lowerLipY /= lowerLipIndices.length;
    
    // Current vertical mouth opening
    const currentMouthOpening = Math.abs(lowerLipY - upperLipY);
    
    // Previous vertical mouth opening
    let prevUpperLipY = 0;
    let prevLowerLipY = 0;
    
    upperLipIndices.forEach(index => {
      if (previousLandmarks[index]) {
        prevUpperLipY += previousLandmarks[index].y;
      }
    });
    prevUpperLipY /= upperLipIndices.length;
    
    lowerLipIndices.forEach(index => {
      if (previousLandmarks[index]) {
        prevLowerLipY += previousLandmarks[index].y;
      }
    });
    prevLowerLipY /= lowerLipIndices.length;
    
    const previousMouthOpening = Math.abs(prevLowerLipY - prevUpperLipY);
    
    // Calculate change in mouth opening
    verticalMovement = Math.abs(currentMouthOpening - previousMouthOpening);
    
    // Also check horizontal movement of mouth corners
    let horizontalMovement = 0;
    cornerIndices.forEach(index => {
      const current = currentLandmarks[index];
      const previous = previousLandmarks[index];
      
      if (current && previous) {
        // Focus more on horizontal movement (x) for mouth corners
        const dx = current.x - previous.x;
        horizontalMovement += Math.abs(dx);
      }
    });
    
    // Weight vertical movement more heavily as it's more indicative of speaking
    return (verticalMovement * 3) + (horizontalMovement * 1);
  };

  // Helper function to calculate face bounding box from landmarks
  const calculateFaceBoundingBox = (landmarks: any[]) => {
    // Use specific landmarks to determine face boundaries
    // These indices represent points around the face perimeter
    const faceOutlineIndices = [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
      397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
      172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
    ];
    
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    
    faceOutlineIndices.forEach(index => {
      if (landmarks[index]) {
        minX = Math.min(minX, landmarks[index].x);
        minY = Math.min(minY, landmarks[index].y);
        maxX = Math.max(maxX, landmarks[index].x);
        maxY = Math.max(maxY, landmarks[index].y);
      }
    });
    
    // Add some padding around the face (10%)
    const width = maxX - minX;
    const height = maxY - minY;
    const padding = Math.max(width, height) * 0.15;
    
    return {
      x: Math.max(0, minX - padding),
      y: Math.max(0, minY - padding),
      width: Math.min(1 - minX, width + padding * 2),
      height: Math.min(1 - minY, height + padding * 2)
    };
  };

  // Function to handle zoom transitions
  const updateZoomTransition = () => {
    const { progress, targetX, targetY, targetScale, startX, startY, startScale } = zoomTransition.current;
    
    // Use easing function for smooth transition
    const easedProgress = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
    // Calculate current position based on transition progress
    const currentX = startX + (targetX - startX) * easedProgress;
    const currentY = startY + (targetY - startY) * easedProgress;
    const currentScale = startScale + (targetScale - startScale) * easedProgress;
    
    return { currentX, currentY, currentScale };
  };

  // onResults callback to draw detected mouth landmarks
  const onResults = useCallback((results: any) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Increment frame counter
    frameCounter.current += 1;

    // Find any speaking faces
    let anySpeaking = false;
    let speakingFaceIndex = -1;
    
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      // First pass: update speaking status and store face positions
      results.multiFaceLandmarks.forEach((landmarks: any, faceIndex: number) => {
        // Calculate and store face bounding box
        const faceBBox = calculateFaceBoundingBox(landmarks);
        facePositions.current.set(faceIndex, faceBBox);
        
        // Get previous landmarks for this face
        const prevLandmarks = prevMouthPositions.current.get(faceIndex);
        
        // Calculate mouth movement if we have previous landmarks
        let isSpeaking = speakingFaces.current.get(faceIndex) || false;
        
        if (prevLandmarks) {
          const movement = calculateMouthMovement(landmarks, prevLandmarks);
          
          // Threshold for considering someone is speaking
          const SPEAKING_THRESHOLD = 0.005;
          
          // Get current counters or initialize them
          let speakingCounter = speakingCounters.current.get(faceIndex) || 0;
          let notSpeakingCounter = notSpeakingCounters.current.get(faceIndex) || 0;
          
          // Implement debouncing - require consistent detection before changing state
          if (movement > SPEAKING_THRESHOLD) {
            // Increment speaking counter, reset not speaking counter
            speakingCounter++;
            notSpeakingCounter = 0;
            
            // Only change to speaking state after several consistent detections
            if (speakingCounter >= 3 && !isSpeaking) {
              isSpeaking = true;
            }
          } else {
            // Increment not speaking counter, reset speaking counter
            notSpeakingCounter++;
            speakingCounter = 0;
            
            // Only change to not speaking state after several consistent detections
            if (notSpeakingCounter >= 5 && isSpeaking) {
              isSpeaking = false;
            }
          }
          
          // Update counters
          speakingCounters.current.set(faceIndex, speakingCounter);
          notSpeakingCounters.current.set(faceIndex, notSpeakingCounter);
          
          // Update speaking status
          speakingFaces.current.set(faceIndex, isSpeaking);
          
          // Track if any face is speaking
          if (isSpeaking) {
            anySpeaking = true;
            speakingFaceIndex = faceIndex;
          }
        }
        
        // Store current landmarks for next frame comparison
        prevMouthPositions.current.set(faceIndex, [...landmarks]);
      });
      
      // Update zoom target if needed
      if (zoomEnabled) {
        // If we have a speaking face and it's different from current zoom target
        if (anySpeaking && (currentZoomFace.current !== speakingFaceIndex)) {
          const faceBBox = facePositions.current.get(speakingFaceIndex);
          
          if (faceBBox) {
            // Calculate center of face
            const centerX = faceBBox.x + faceBBox.width / 2;
            const centerY = faceBBox.y + faceBBox.height / 2;
            
            // Calculate appropriate zoom scale (inverse of face size)
            // Smaller faces get zoomed in more
            const scale = Math.min(2.5, 0.4 / Math.max(faceBBox.width, faceBBox.height));
            
            // Start a new transition
            zoomTransition.current = {
              progress: 0,
              targetX: centerX,
              targetY: centerY,
              targetScale: scale,
              startX: zoomTransition.current.targetX,
              startY: zoomTransition.current.targetY,
              startScale: zoomTransition.current.targetScale
            };
            
            currentZoomFace.current = speakingFaceIndex;
          }
        } 
        // If no one is speaking and we were zoomed in, transition back to normal view
        else if (!anySpeaking && currentZoomFace.current !== null) {
          zoomTransition.current = {
            progress: 0,
            targetX: 0.5,
            targetY: 0.5,
            targetScale: 1,
            startX: zoomTransition.current.targetX,
            startY: zoomTransition.current.targetY,
            startScale: zoomTransition.current.targetScale
          };
          
          currentZoomFace.current = null;
        }
        
        // Update transition progress
        if (zoomTransition.current.progress < 1) {
          zoomTransition.current.progress = Math.min(1, zoomTransition.current.progress + 0.05);
        }
      }
      
      // Apply zoom transformation to canvas
      if (zoomEnabled) {
        const { currentX, currentY, currentScale } = updateZoomTransition();
        
        // Save the current state
        ctx.save();
        
        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Translate to center of canvas
        ctx.translate(canvas.width / 2, canvas.height / 2);
        
        // Scale around the center
        ctx.scale(currentScale, currentScale);
        
        // Translate to keep the target point centered
        ctx.translate(
          -canvas.width * currentX,
          -canvas.height * currentY
        );
      }
      
      // Second pass: draw faces and mouth landmarks
      results.multiFaceLandmarks.forEach((landmarks: any, faceIndex: number) => {
        // Mouth landmark indices
        const mouthIndices = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
        
        // Get speaking status for this face
        const isFaceSpeaking = speakingFaces.current.get(faceIndex) || false;
        
        // Draw mouth outline
        ctx.beginPath();
        mouthIndices.forEach((index, i) => {
          const landmark = landmarks[index];
          const x = landmark.x * canvas.width;
          const y = landmark.y * canvas.height;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.closePath();
        
        // Set color based on speaking status
        ctx.strokeStyle = isFaceSpeaking ? "red" : "lime";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Add a label to indicate speaking status
        if (isFaceSpeaking) {
          const mouthTop = landmarks[61];
          const labelX = mouthTop.x * canvas.width;
          const labelY = (mouthTop.y * canvas.height) - 10;
          
          ctx.font = "16px Arial";
          ctx.fillStyle = "red";
          ctx.fillText("Speaking", labelX - 30, labelY);
        }
      });
      
      // Restore canvas state if zoom was applied
      if (zoomEnabled) {
        ctx.restore();
      }
    }
  }, [zoomEnabled]);

  // Set up camera and Mediapipe FaceMesh pipeline
  useEffect(() => {
    async function setupCameraAndMediapipe() {
      try {
        // Get the camera stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Dynamically import Mediapipe modules
        const { FaceMesh } = await import("@mediapipe/face_mesh");
        const { Camera } = await import("@mediapipe/camera_utils");

        // Initialize FaceMesh with a locateFile function for WASM assets
        const faceMesh = new FaceMesh({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        faceMesh.setOptions({
          // TODO: diff model to dynamically change/detect faces
          maxNumFaces: 5,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);

        // Use Mediapipe Camera utility to process each frame
        if (videoRef.current) {
          const mpCamera = new Camera(videoRef.current, {
            onFrame: async () => {
              await faceMesh.send({ image: videoRef.current! });
            },
            width: 640,
            height: 480,
          });
          mpCamera.start();
        }
      } catch (err) {
        console.error("Error setting up camera or Mediapipe:", err);
      }
    }
    setupCameraAndMediapipe();

    // Cleanup: Stop all tracks when component unmounts
    return () => {
      const stream = videoRef.current?.srcObject as MediaStream;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [onResults]);

  // Recording functionality remains the same
  const startRecording = () => {
    chunks.current = [];
    const stream = videoRef.current?.srcObject as MediaStream;
    if (stream) {
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: "video/webm" });
        const videoURL = URL.createObjectURL(blob);
        setRecordedVideo(videoURL);
        setRecordedBlob(blob);
      };
      mediaRecorder.start();
      setRecording(true);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const toggleAudio = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioEnabled;
        setAudioEnabled(!audioEnabled);
      }
    }
  };
  
  const toggleZoom = () => {
    setZoomEnabled(!zoomEnabled);
    
    // Reset zoom when disabling
    if (zoomEnabled) {
      zoomTransition.current = {
        progress: 0,
        targetX: 0.5,
        targetY: 0.5,
        targetScale: 1,
        startX: zoomTransition.current.targetX,
        startY: zoomTransition.current.targetY,
        startScale: zoomTransition.current.targetScale
      };
      currentZoomFace.current = null;
    }
  };

  const downloadVideo = () => {
    if (recordedBlob) {
      const url = window.URL.createObjectURL(recordedBlob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `recorded-video-${timestamp}.webm`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  };

  return (
    <div className="min-h-screen p-8 flex flex-col items-center gap-8">
      <h1 className="text-2xl font-bold">Video Recorder with Mediapipe</h1>

      <div className="flex flex-col items-center gap-4">
        {/* Video container with canvas overlay */}
        <div className="relative w-[640px] h-[480px] bg-gray-900 rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            className="absolute top-0 left-0"
          />
        </div>

        <div className="flex gap-4">
          {!recording ? (
            <>
              <button
                onClick={startRecording}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
              >
                Start Recording
              </button>
              <button
                onClick={toggleAudio}
                className={`px-4 py-2 ${
                  audioEnabled
                    ? "bg-green-500 hover:bg-green-600"
                    : "bg-gray-500 hover:bg-gray-600"
                } text-white rounded-md transition-colors`}
              >
                {audioEnabled ? "Mic On" : "Mic Off"}
              </button>
              <button
                onClick={toggleZoom}
                className={`px-4 py-2 ${
                  zoomEnabled
                    ? "bg-indigo-500 hover:bg-indigo-600"
                    : "bg-gray-500 hover:bg-gray-600"
                } text-white rounded-md transition-colors`}
              >
                {zoomEnabled ? "Zoom On" : "Zoom Off"}
              </button>
            </>
          ) : (
            <button
              onClick={stopRecording}
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
            >
              Stop Recording
            </button>
          )}
        </div>
      </div>

      {recordedVideo && (
        <div className="flex flex-col items-center gap-4">
          <h2 className="text-xl font-semibold">Recorded Video</h2>
          <video
            src={recordedVideo}
            controls
            className="w-[640px] rounded-lg"
          />
          <button
            onClick={downloadVideo}
            className="px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors"
          >
            Download Video
          </button>
        </div>
      )}
    </div>
  );
}
