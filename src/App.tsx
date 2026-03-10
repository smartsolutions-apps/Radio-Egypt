/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX, 
  Search, 
  Settings,
  List,
  Share2,
  Star,
  ChevronDown,
  Loader2,
  Sparkles,
  X,
  Languages,
  Music2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RadioService, RadioStation } from './services/RadioService';
import { LyricsService } from './services/LyricsService';
import { TunerDial } from './components/TunerDial';
import { audioEngine } from './services/AudioEngine';
import { cn } from './lib/utils';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp, 
  handleFirestoreError, 
  OperationType,
  FirebaseUser,
  Timestamp
} from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <RadioApp />
    </ErrorBoundary>
  );
}

function RadioApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [currentStation, setCurrentStation] = useState<RadioStation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [frequency, setFrequency] = useState(92.7);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState('Egypt');
  const [isSearchingFreq, setIsSearchingFreq] = useState(false);
  const [tempFreq, setTempFreq] = useState('');
  const [signalStrength, setSignalStrength] = useState(1);
  const [recentStations, setRecentStations] = useState<RadioStation[]>([]);
  const [sleepTimer, setSleepTimer] = useState<number | null>(null);
  const [alarmTime, setAlarmTime] = useState<string | null>(null);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Lyrics State
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsData, setLyricsData] = useState<{ artist: string; title: string; lyrics: string } | null>(null);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        // Create/Update user profile
        const userRef = doc(db, 'users', currentUser.uid);
        setDoc(userRef, {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          role: 'user', // Default role
          createdAt: serverTimestamp()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`));
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Favorites
  useEffect(() => {
    if (!user || !isAuthReady) {
      setFavorites([]);
      return;
    }

    const favsRef = collection(db, 'users', user.uid, 'favorites');
    const q = query(favsRef, orderBy('addedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const favIds = snapshot.docs.map(doc => doc.data().stationuuid);
      setFavorites(favIds);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/favorites`));

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Firestore Sync: Recents
  useEffect(() => {
    if (!user || !isAuthReady) {
      setRecentStations([]);
      return;
    }

    const recentsRef = collection(db, 'users', user.uid, 'recents');
    const q = query(recentsRef, orderBy('playedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const recents = snapshot.docs.map(doc => ({
        ...doc.data(),
        playedAt: (doc.data().playedAt as Timestamp)?.toDate()
      } as any as RadioStation));
      setRecentStations(recents);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/recents`));

    return () => unsubscribe();
  }, [user, isAuthReady]);

  useEffect(() => {
    loadStations();
  }, []);

  // Signal Strength & Audio Engine Integration
  useEffect(() => {
    if (!stations.length) return;

    // Find nearest station to current frequency
    let minDiff = Infinity;
    let nearest: RadioStation | null = null;

    stations.forEach(s => {
      if (s.frequency) {
        const diff = Math.abs(s.frequency - frequency);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = s;
        }
      }
    });

    // Signal strength: 1 if exactly on station, drops off quickly
    // Clear within 0.1 MHz, noisy beyond that
    const strength = Math.max(0, 1 - (minDiff * 5)); 
    setSignalStrength(strength);
    audioEngine.setMix(strength);

    // Auto-snap if very close
    if (minDiff < 0.05 && nearest && nearest.stationuuid !== currentStation?.stationuuid) {
      playStation(nearest);
      if (navigator.vibrate) navigator.vibrate(20);
    }
  }, [frequency, stations, currentStation]);

  // Media Session API for Background Playback
  useEffect(() => {
    if ('mediaSession' in navigator && currentStation) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentStation.name,
        artist: `${frequency.toFixed(1)} FM`,
        album: country,
        artwork: [
          { src: currentStation.favicon || 'https://picsum.photos/seed/radio/512/512', sizes: '512x512', type: 'image/png' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', togglePlay);
      navigator.mediaSession.setActionHandler('pause', togglePlay);
      navigator.mediaSession.setActionHandler('previoustrack', () => scan('down'));
      navigator.mediaSession.setActionHandler('nexttrack', () => scan('up'));
    }
  }, [currentStation, frequency, isPlaying]);

  // Sleep Timer Logic
  useEffect(() => {
    if (sleepTimer === null) return;
    if (sleepTimer <= 0) {
      if (isPlaying) togglePlay();
      setSleepTimer(null);
      return;
    }

    const interval = setInterval(() => {
      setSleepTimer(prev => (prev !== null ? prev - 1 : null));
    }, 60000);

    return () => clearInterval(interval);
  }, [sleepTimer, isPlaying]);

  // Alarm Logic
  useEffect(() => {
    if (!alarmTime || !isAlarmActive) return;

    const interval = setInterval(() => {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      if (currentTime === alarmTime) {
        if (!isPlaying) togglePlay();
        setIsAlarmActive(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [alarmTime, isAlarmActive, isPlaying]);

  const loadStations = async () => {
    try {
      setIsLoading(true);
      const data = await RadioService.getStationsByCountryCode('EG', 100);
      setStations(data);
      
      // Find station closest to initial frequency
      const closest = data.find(s => s.frequency === 92.7) || data[0];
      if (closest) {
        setCurrentStation(closest);
        if (closest.frequency) setFrequency(closest.frequency);
      }
    } catch (err) {
      setError('Failed to load stations.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFrequencyChange = (newFreq: number) => {
    setFrequency(newFreq);
    // Find station at this frequency
    const station = stations.find(s => s.frequency === newFreq);
    if (station && station.stationuuid !== currentStation?.stationuuid) {
      playStation(station);
    }
  };

  const scan = (direction: 'up' | 'down') => {
    const sortedStations = [...stations]
      .filter(s => s.frequency !== undefined)
      .sort((a, b) => (a.frequency || 0) - (b.frequency || 0));
    
    if (sortedStations.length === 0) return;

    let nextStation;
    if (direction === 'up') {
      nextStation = sortedStations.find(s => (s.frequency || 0) > frequency) || sortedStations[0];
    } else {
      nextStation = [...sortedStations].reverse().find(s => (s.frequency || 0) < frequency) || sortedStations[sortedStations.length - 1];
    }

    if (nextStation) {
      setFrequency(nextStation.frequency || frequency);
      playStation(nextStation);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !currentStation) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play().catch(() => setError("Playback failed."));
    setIsPlaying(!isPlaying);
  };

  const playStation = async (station: RadioStation) => {
    setCurrentStation(station);
    setIsPlaying(true);
    
    // Add to recents in Firestore
    if (user) {
      const recentRef = doc(db, 'users', user.uid, 'recents', station.stationuuid);
      setDoc(recentRef, {
        stationuuid: station.stationuuid,
        name: station.name,
        frequency: station.frequency,
        favicon: station.favicon || null,
        playedAt: serverTimestamp()
      }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/recents/${station.stationuuid}`));
    }

    if (audioRef.current) {
      audioRef.current.src = station.url_resolved;
      audioRef.current.play().catch(() => {
        setError("Stream offline.");
        setIsPlaying(false);
      });
      audioEngine.connectStream(audioRef.current);
    }
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const toggleFavorite = async (station: RadioStation) => {
    if (!user) {
      setError("Please login to save favorites.");
      return;
    }

    const isFav = favorites.includes(station.stationuuid);
    const favRef = doc(db, 'users', user.uid, 'favorites', station.stationuuid);

    try {
      if (isFav) {
        await deleteDoc(favRef);
      } else {
        await setDoc(favRef, {
          stationuuid: station.stationuuid,
          name: station.name,
          frequency: station.frequency,
          favicon: station.favicon || null,
          url_resolved: station.url_resolved,
          addedAt: serverTimestamp()
        });
      }
    } catch (err) {
      handleFirestoreError(err, isFav ? OperationType.DELETE : OperationType.WRITE, `users/${user.uid}/favorites/${station.stationuuid}`);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError("Login failed.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      setError("Logout failed.");
    }
  };

  const fetchLyrics = async () => {
    if (!currentStation) return;
    try {
      setIsFetchingLyrics(true);
      setShowLyrics(true);
      const data = await LyricsService.getNowPlayingAndLyrics(currentStation.name);
      if (data) setLyricsData(data);
      else setError("Lyrics not found.");
    } catch (err) {
      setError("Failed to fetch lyrics.");
    } finally {
      setIsFetchingLyrics(false);
    }
  };

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans flex flex-col items-center justify-center p-4">
      <audio ref={audioRef} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />

      <div className="w-full max-w-md bg-white h-[800px] shadow-2xl rounded-[3rem] border-[8px] border-gray-100 overflow-hidden flex flex-col relative">
        
        {/* Top Status Bar */}
        <div className="px-8 pt-12 pb-4 flex items-center justify-between">
          <button className="flex items-center gap-1 bg-gray-100 px-4 py-2 rounded-full text-sm font-medium text-gray-600">
            {country} <ChevronDown size={14} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 mr-2">
              {[1, 2, 3, 4].map((bar) => (
                <div 
                  key={bar}
                  className={cn(
                    "w-1 rounded-full transition-all",
                    bar === 1 ? "h-2" : bar === 2 ? "h-3" : bar === 3 ? "h-4" : "h-5",
                    signalStrength > (bar - 1) / 4 ? "bg-red-500" : "bg-gray-200"
                  )}
                />
              ))}
            </div>
            <button 
              onClick={() => {
                setTempFreq(frequency.toFixed(1));
                setIsSearchingFreq(true);
              }}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-red-500"
            >
              <Search size={24} />
            </button>
            <button 
              onClick={() => currentStation && toggleFavorite(currentStation)}
              className={cn("p-2", favorites.includes(currentStation?.stationuuid || '') ? "text-red-500" : "text-gray-300")}
            >
              <Star size={28} fill={favorites.includes(currentStation?.stationuuid || '') ? "currentColor" : "none"} />
            </button>
          </div>
          <button 
            onClick={user ? handleLogout : handleLogin}
            className="text-red-500 font-bold text-sm uppercase tracking-wider"
          >
            {user ? 'Logout' : 'Login'}
          </button>
        </div>

        {/* Main Frequency Display */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="relative mb-4 group">
            {isSearchingFreq ? (
              <div className="flex flex-col items-center">
                <input 
                  autoFocus
                  type="number"
                  step="0.1"
                  placeholder="00.0"
                  value={tempFreq}
                  onChange={(e) => setTempFreq(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = parseFloat(tempFreq);
                      if (!isNaN(val) && val >= 87.5 && val <= 108) {
                        handleFrequencyChange(val);
                        setIsSearchingFreq(false);
                      }
                    }
                    if (e.key === 'Escape') setIsSearchingFreq(false);
                  }}
                  className="text-[80px] font-extralight tracking-tighter leading-none text-red-500 bg-transparent border-b-2 border-red-500 w-64 text-center focus:outline-none"
                />
                <p className="text-xs text-gray-400 mt-2">Press Enter to Tune</p>
              </div>
            ) : (
              <button 
                onClick={() => {
                  setTempFreq(frequency.toFixed(1));
                  setIsSearchingFreq(true);
                }}
                className="relative hover:scale-105 transition-transform"
              >
                <span className="text-[120px] font-extralight tracking-tighter leading-none text-gray-800">
                  {frequency.toFixed(1)}
                </span>
                <div className="absolute -right-12 top-1/2 -translate-y-1/2 flex flex-col items-center">
                  <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center mb-1">
                    <div className="w-4 h-4 border-2 border-white rounded-full animate-ping" />
                  </div>
                  <span className="text-xl font-bold text-gray-400">FM</span>
                </div>
              </button>
            )}
          </div>

          <h2 className="text-2xl font-medium text-gray-600 mb-2">
            {currentStation?.name || 'Scanning...'}
          </h2>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSettings(true)}
              className="text-red-500 font-semibold text-lg hover:opacity-70 transition-opacity"
            >
              Options
            </button>
            {sleepTimer !== null && (
              <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-500 font-mono">
                Sleep: {sleepTimer}m
              </span>
            )}
          </div>

          {/* Action Icons */}
          <div className="flex items-center justify-between w-full mt-12 px-4">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-4 text-red-500 hover:bg-red-50 rounded-full transition-all"
            >
              <Settings size={28} />
            </button>
            <button 
              onClick={() => setShowFavorites(true)}
              className="p-4 text-red-500 hover:bg-red-50 rounded-full transition-all"
            >
              <List size={28} />
            </button>
            <button className="p-4 text-red-500 hover:bg-red-50 rounded-full transition-all">
              <Share2 size={28} />
            </button>
          </div>
        </div>

        {/* Tuner Dial */}
        <div className="w-full">
          <TunerDial frequency={frequency} onChange={handleFrequencyChange} />
        </div>

        {/* Controls */}
        <div className="px-8 py-10 flex flex-col items-center gap-8 bg-gray-50/50">
          <div className="flex items-center justify-center gap-12 w-full">
            <button 
              onClick={() => scan('down')}
              className="text-gray-800 hover:scale-110 active:scale-95 transition-all"
            >
              <SkipBack size={40} fill="currentColor" />
            </button>
            <button 
              onClick={togglePlay}
              className="w-20 h-20 bg-gray-800 text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl shadow-gray-200"
            >
              {isPlaying ? <Pause size={40} fill="currentColor" /> : <Play size={40} fill="currentColor" className="ml-1" />}
            </button>
            <button 
              onClick={() => scan('up')}
              className="text-gray-800 hover:scale-110 active:scale-95 transition-all"
            >
              <SkipForward size={40} fill="currentColor" />
            </button>
          </div>

          {/* Volume Slider */}
          <div className="w-full flex items-center gap-4">
            <VolumeX size={18} className="text-gray-400" />
            <div className="flex-1 relative h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="absolute left-0 top-0 bottom-0 bg-gray-600 transition-all"
                style={{ width: `${volume * 100}%` }}
              />
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <Volume2 size={18} className="text-gray-400" />
          </div>
        </div>

        {/* AI Lyrics Button (Floating) */}
        <button 
          onClick={fetchLyrics}
          className="absolute right-6 bottom-40 w-12 h-12 bg-red-500 text-white rounded-full shadow-lg flex items-center justify-center hover:scale-110 transition-all z-30"
        >
          <Languages size={20} />
        </button>

      </div>

      {/* Favorites Overlay */}
      <AnimatePresence>
        {showFavorites && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            className="fixed inset-0 z-50 bg-white flex flex-col"
          >
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-xl font-bold text-red-500 flex items-center gap-2">
                <Star size={20} fill="currentColor" /> Favorites
              </h3>
              <button onClick={() => setShowFavorites(false)} className="p-2 bg-gray-100 rounded-full">
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {favorites.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Star size={48} className="mb-4 opacity-20" />
                  <p>No favorites yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stations.filter(s => favorites.includes(s.stationuuid)).map(station => (
                    <div 
                      key={station.stationuuid}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-colors cursor-pointer"
                      onClick={() => {
                        setFrequency(station.frequency || frequency);
                        playStation(station);
                        setShowFavorites(false);
                      }}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center border border-gray-100 overflow-hidden">
                          {station.favicon ? (
                            <img src={station.favicon} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Music2 className="text-gray-300" />
                          )}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-800">{station.name}</h4>
                          <p className="text-sm text-gray-400">{station.frequency?.toFixed(1)} FM</p>
                        </div>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(station);
                        }}
                        className="p-2 text-red-500"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings/Utility Overlay */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  {user?.photoURL && (
                    <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full border-2 border-red-500" />
                  )}
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">{user?.displayName || 'Utilities'}</h3>
                    {user && <p className="text-xs text-gray-400">{user.email}</p>}
                  </div>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 bg-gray-100 rounded-full">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-8">
                {!user && (
                  <button 
                    onClick={handleLogin}
                    className="w-full bg-red-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:scale-[1.02] transition-all"
                  >
                    Login with Google
                  </button>
                )}
                {/* Sleep Timer */}
                <div>
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 block">Sleep Timer</label>
                  <div className="flex gap-2">
                    {[15, 30, 45, 60].map(mins => (
                      <button
                        key={mins}
                        onClick={() => {
                          setSleepTimer(mins);
                          setShowSettings(false);
                        }}
                        className={cn(
                          "flex-1 py-3 rounded-2xl font-bold transition-all",
                          sleepTimer === mins ? "bg-red-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        )}
                      >
                        {mins}m
                      </button>
                    ))}
                    {sleepTimer && (
                      <button onClick={() => setSleepTimer(null)} className="p-3 bg-gray-100 rounded-2xl text-red-500">
                        <X size={20} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Alarm Clock */}
                <div>
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 block">Alarm Clock</label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="time" 
                      value={alarmTime || ''}
                      onChange={(e) => setAlarmTime(e.target.value)}
                      className="flex-1 bg-gray-100 p-4 rounded-2xl font-bold text-xl focus:outline-none focus:ring-2 ring-red-500/20"
                    />
                    <button
                      onClick={() => setIsAlarmActive(!isAlarmActive)}
                      className={cn(
                        "p-4 rounded-2xl transition-all",
                        isAlarmActive ? "bg-red-500 text-white" : "bg-gray-100 text-gray-400"
                      )}
                    >
                      <Play size={24} fill={isAlarmActive ? "currentColor" : "none"} />
                    </button>
                  </div>
                </div>

                {/* Recently Played */}
                <div>
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 block">Recently Played</label>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                    {recentStations.map(station => (
                      <button
                        key={station.stationuuid}
                        onClick={() => {
                          setFrequency(station.frequency || frequency);
                          playStation(station);
                          setShowSettings(false);
                        }}
                        className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center overflow-hidden border-2 border-transparent hover:border-red-500 transition-all"
                      >
                        {station.favicon ? (
                          <img src={station.favicon} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="text-xs font-bold text-gray-400">{station.frequency?.toFixed(0)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lyrics Overlay */}
      <AnimatePresence>
        {showLyrics && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            className="fixed inset-0 z-50 bg-white flex flex-col"
          >
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-xl font-bold text-red-500 flex items-center gap-2">
                <Sparkles size={20} /> AI Lyrics
              </h3>
              <button onClick={() => setShowLyrics(false)} className="p-2 bg-gray-100 rounded-full">
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 text-center">
              {isFetchingLyrics ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <Loader2 className="w-12 h-12 text-red-500 animate-spin" />
                  <p className="text-gray-400 font-medium">Identifying song...</p>
                </div>
              ) : lyricsData ? (
                <div className="max-w-md mx-auto">
                  <h2 className="text-3xl font-bold mb-2">{lyricsData.title}</h2>
                  <p className="text-red-500 font-medium text-xl mb-8">{lyricsData.artist}</p>
                  <pre className="font-sans text-lg leading-relaxed text-gray-600 whitespace-pre-wrap italic">
                    {lyricsData.lyrics}
                  </pre>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <Music2 size={48} className="text-gray-200" />
                  <p className="text-gray-400">No lyrics found.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full shadow-xl z-[100] animate-bounce">
          {error}
        </div>
      )}
    </div>
  );
}
