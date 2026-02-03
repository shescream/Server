// React/React Native Client Example for Women Safety App
import React, { useState, useRef } from 'react';

const SERVER_URL = 'http://localhost:5000';

export function PanicButton() {
  const [sessionId, setSessionId] = useState(null);
  const [isPanic, setIsPanic] = useState(false);
  const [dangerIndex, setDangerIndex] = useState(0);
  const audioIntervalRef = useRef(null);
  const sensorIntervalRef = useRef(null);

  // Handle panic button press
  const handlePanicClick = async () => {
    try {
      const location = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          (error) => reject(error)
        );
      });

      const response = await fetch(`${SERVER_URL}/api/panic/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user_' + Date.now(),
          latitude: location.latitude,
          longitude: location.longitude,
          timestamp: new Date().toISOString(),
        }),
      });

      const data = await response.json();
      setSessionId(data.sessionId);
      setIsPanic(true);

      startAudioSending(data.sessionId);
      startSensorSending(data.sessionId);
    } catch (error) {
      console.error('Failed to activate panic:', error);
    }
  };

  const startAudioSending = (session) => {
    audioIntervalRef.current = setInterval(async () => {
      try {
        const audioBlob = await recordAudio(5000); // 5 seconds

        const formData = new FormData();
        formData.append('audio', audioBlob, 'alert.mp3');
        formData.append('sessionId', session);
        formData.append('timestamp', new Date().toISOString());

        const response = await fetch(`${SERVER_URL}/api/audio/upload`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        setDangerIndex(data.dangerIndex);
      } catch (error) {
        console.error('Failed to send audio:', error);
      }
    }, 5000);
  };

  const startSensorSending = (session) => {
    sensorIntervalRef.current = setInterval(async () => {
      try {
        let accelData = [0, 0, 9.8];
        let gyroData = [0, 0, 0];

        if (window.DeviceMotionEvent) {
          if (
            typeof DeviceMotionEvent !== 'undefined' &&
            typeof DeviceMotionEvent.requestPermission === 'function'
          ) {
            const permission = await DeviceMotionEvent.requestPermission();
            if (permission === 'granted') {
              window.addEventListener('devicemotion', (event) => {
                accelData = [
                  event.acceleration.x || 0,
                  event.acceleration.y || 0,
                  event.acceleration.z || 0,
                ];
                gyroData = [
                  event.rotationRate.alpha || 0,
                  event.rotationRate.beta || 0,
                  event.rotationRate.gamma || 0,
                ];
              });
            }
          }
        }

        const response = await fetch(`${SERVER_URL}/api/sensor/data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: session,
            accelerometer: accelData,
            gyroscope: gyroData,
            timestamp: new Date().toISOString(),
          }),
        });

        const data = await response.json();
        setDangerIndex(data.dangerIndex);
      } catch (error) {
        console.error('Failed to send sensor data:', error);
      }
    }, 5000);
  };

  const handleStopPanic = async () => {
    try {
      clearInterval(audioIntervalRef.current);
      clearInterval(sensorIntervalRef.current);

      if (sessionId) {
        await fetch(`${SERVER_URL}/api/session/${sessionId}/deactivate`, {
          method: 'POST',
        });
      }

      setIsPanic(false);
      setSessionId(null);
    } catch (error) {
      console.error('Failed to stop panic:', error);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>🚨 Women Safety Alert</h1>

      <div style={styles.dangerCard}>
        <p style={styles.label}>Danger Index</p>
        <p style={styles.dangerValue}>{dangerIndex.toFixed(2)}</p>
        <div
          style={{
            ...styles.dangerBar,
            backgroundColor:
              dangerIndex > 0.7
                ? '#ef4444'
                : dangerIndex > 0.4
                ? '#f59e0b'
                : '#10b981',
          }}
        >
          <div
            style={{
              width: `${dangerIndex * 100}%`,
              height: '100%',
              backgroundColor: 'currentColor',
            }}
          />
        </div>
      </div>

      <button
        onClick={isPanic ? handleStopPanic : handlePanicClick}
        style={{
          ...styles.button,
          backgroundColor: isPanic ? '#10b981' : '#ef4444',
        }}
      >
        {isPanic ? '✅ STOP ALERT' : '🚨 PANIC BUTTON'}
      </button>

      {sessionId && (
        <p style={styles.sessionInfo}>
          Session: {sessionId.substring(0, 8)}...
        </p>
      )}
    </div>
  );
}

// Dummy audio recording function
async function recordAudio(duration) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const canvas = new OffscreenCanvas(1, 1);
  return new Blob(['audio data'], { type: 'audio/mp3' });
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f172a 0%, #1a1f3a 100%)',
    color: '#e2e8f0',
    fontFamily: 'sans-serif',
    padding: '20px',
  },
  title: {
    fontSize: '2.5em',
    marginBottom: '40px',
    color: '#06b6d4',
  },
  dangerCard: {
    background: 'rgba(15, 23, 42, 0.8)',
    border: '2px solid #06b6d4',
    borderRadius: '12px',
    padding: '30px',
    marginBottom: '40px',
    minWidth: '250px',
    textAlign: 'center',
  },
  label: {
    fontSize: '0.9em',
    color: '#cbd5e1',
    marginBottom: '10px',
  },
  dangerValue: {
    fontSize: '3em',
    fontWeight: 'bold',
    margin: '10px 0',
    color: '#06b6d4',
  },
  dangerBar: {
    width: '100%',
    height: '8px',
    background: '#334155',
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: '20px',
  },
  button: {
    padding: '20px 40px',
    fontSize: '1.3em',
    fontWeight: 'bold',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    color: 'white',
    transition: 'all 0.3s ease',
    minWidth: '250px',
  },
  sessionInfo: {
    marginTop: '30px',
    color: '#94a3b8',
    fontSize: '0.9em',
  },
};

// If this is in App.js, add:
export default PanicButton;
