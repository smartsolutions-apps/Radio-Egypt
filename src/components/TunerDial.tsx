import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'motion/react';

interface TunerDialProps {
  frequency: number;
  onChange: (freq: number) => void;
}

export const TunerDial: React.FC<TunerDialProps> = ({ frequency, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startFreq, setStartFreq] = useState(frequency);

  const minFreq = 87.5;
  const maxFreq = 108.0;
  const pixelsPerFreq = 100; // How many pixels represent 1 MHz

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setStartX(e.pageX);
    setStartFreq(frequency);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    setStartX(e.touches[0].pageX);
    setStartFreq(frequency);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.pageX - startX;
      const freqDiff = dx / pixelsPerFreq;
      let newFreq = startFreq - freqDiff;
      newFreq = Math.max(minFreq, Math.min(maxFreq, Math.round(newFreq * 10) / 10));
      onChange(newFreq);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;
      const dx = e.touches[0].pageX - startX;
      const freqDiff = dx / pixelsPerFreq;
      let newFreq = startFreq - freqDiff;
      newFreq = Math.max(minFreq, Math.min(maxFreq, Math.round(newFreq * 10) / 10));
      onChange(newFreq);
    };

    const handleEnd = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, startX, startFreq, onChange]);

  // Generate ticks
  const ticks = [];
  for (let f = minFreq - 2; f <= maxFreq + 2; f = Math.round((f + 0.1) * 10) / 10) {
    ticks.push(f);
  }

  const offset = (frequency - minFreq) * pixelsPerFreq;

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-32 overflow-hidden bg-gray-50/50 border-y border-gray-100 cursor-grab active:cursor-grabbing select-none rounded-xl"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Center Indicator */}
      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-red-500 z-10 shadow-[0_0_10px_rgba(239,68,68,0.5)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
      </div>
      
      {/* Ticks Container */}
      <div 
        className="absolute top-0 bottom-0 flex items-end pb-4 transition-transform duration-75 ease-out"
        style={{ transform: `translateX(calc(50% - ${offset}px))` }}
      >
        {ticks.map((f) => {
          const isMajor = Math.round(f * 10) % 10 === 0;
          const isHalf = Math.round(f * 10) % 5 === 0 && !isMajor;
          
          return (
            <div 
              key={f} 
              className="flex flex-col items-center flex-shrink-0 group/tick"
              style={{ width: pixelsPerFreq / 10 }}
            >
              {isMajor && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(f);
                  }}
                  className="text-[11px] font-bold text-gray-400 mb-2 hover:text-red-500 transition-colors cursor-pointer p-1"
                >
                  {Math.round(f)}
                </button>
              )}
              <div 
                className={`w-px transition-colors ${
                  isMajor ? 'h-8 bg-gray-400' : isHalf ? 'h-6 bg-gray-300' : 'h-4 bg-gray-200'
                } group-hover/tick:bg-red-400`} 
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
