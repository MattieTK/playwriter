/**
 * Hero sections for the Playwriter landing and cloud browsers pages.
 *
 * HeroSection / CloudHeroSection: stay within the Above column (page width)
 * via w-full, same as gpuix's hero-section.tsx.
 * ChangelogHeroSection: still breaks out full-bleed via w-screen + negative margin.
 * All share the same VideoBackgroundShader background and star rating badge.
 */
'use client'

import { useEffect, useState } from 'react'
import { VideoBackgroundShader } from '@holocron.so/vite/mdx'

function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor'>
      <path d='M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z' />
    </svg>
  )
}

/** Chrome icon from Element Plus, inherits currentColor. */
function ChromeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 1024 1024' fill='currentColor'>
      <path d='M938.7 512c0-44.6-6.9-87.6-19.6-128H682.7a212 212 0 0 1 42.6 128c.1 38.7-10.4 76.7-30.4 109.9L512 938.7c235.7 0 426.7-191 426.7-426.7' />
      <path d='M576.8 401.6a128 128 0 0 0-63.6-17.6a128 128 0 0 0-111.1 62.4a128 128 0 0 0-2.2 127.5l1.3 2.1a128 128 0 0 0 46.3 46.6A128 128 0 0 0 511 640c22.3.2 44.3-5.4 63.7-16.3a128 128 0 0 0 47.2-45.8l1-1.9a128 128 0 0 0 .4-127.5a128 128 0 0 0-46.4-46.9' />
      <path d='M394.5 334A213 213 0 0 1 512 298.7h369.6A427 427 0 0 0 512 85.3a426 426 0 0 0-171.7 36a426 426 0 0 0-142.7 102.2l118.2 204.7a213 213 0 0 1 78.6-94.2m20.4 368a213 213 0 0 1-89.6-86.9L142.5 298.6a426.8 426.8 0 0 0 276.8 630l118.2-204.7a213 213 0 0 1-122.7-22' />
    </svg>
  )
}

function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24'>
      <path d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z' fill='#4285F4' />
      <path d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z' fill='#34A853' />
      <path d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z' fill='#FBBC05' />
      <path d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z' fill='#EA4335' />
    </svg>
  )
}

function StarIcon({ filled, half }: { filled?: boolean; half?: boolean }) {
  if (half) {
    return (
      <svg width={14} height={14} viewBox='0 0 24 24'>
        <defs>
          <linearGradient id='half-star'>
            <stop offset='50%' stopColor='#FACC15' />
            <stop offset='50%' stopColor='transparent' />
          </linearGradient>
        </defs>
        <path
          d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
          fill='url(#half-star)'
          stroke='#FACC15'
          strokeWidth={1.5}
        />
      </svg>
    )
  }
  return (
    <svg width={14} height={14} viewBox='0 0 24 24'>
      <path
        d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
        fill={filled ? '#FACC15' : 'none'}
        stroke='#FACC15'
        strokeWidth={1.5}
      />
    </svg>
  )
}

function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating)
  const hasHalf = rating - fullStars >= 0.3
  const stars: React.ReactNode[] = Array.from({ length: 5 }, (_, i) => {
    if (i < fullStars) {
      return <StarIcon key={i} filled />
    }
    if (i === fullStars && hasHalf) {
      return <StarIcon key={i} half />
    }
    return <StarIcon key={i} />
  })

  return (
    <a
      href='https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe'
      target='_blank'
      rel='noopener noreferrer'
      className='flex items-center gap-2 mt-5 no-underline text-foreground/50 hover:text-foreground/70 transition-colors'
    >
      <div className='flex items-center gap-0.5'>{stars}</div>
      <span className='text-[13px] font-medium'>{rating}</span>
      <span className='text-[12px] text-foreground/40'>·</span>
      <span className='text-[12px] text-foreground/40'>20k+ users</span>
    </a>
  )
}

// note: canvasClassName opacity utilities do NOT work — VideoBackgroundShader sets
// inline `opacity: 1` on the same element once the canvas is ready, overriding any
// class-based opacity. Dim via an outer wrapper div instead.
function HeroBackground({ dotColor = 'rgba(255, 106, 0, 0.7)' }: { dotColor?: string }) {
  return (
    <div className='absolute inset-0 w-full h-full opacity-70'>
      <VideoBackgroundShader
        src='/assets/hero-bg.mp4'
        className='absolute inset-0 w-full h-full'
        dotStyle='ascii'
        dotColor={dotColor}
        dotSize={10}
        chars=' .:-~=playwriter'
        animSpeed={3}
        gamma={0.8}
        enableMask={false}
        fadeTop={false}
        fadeBottom={false}
        fluidStrength={0.15}
        fluidCurl={80}
      />
    </div>
  )
}

const HERO_FONT = "'IvarText', serif"

const CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe'
const GITHUB_URL = 'https://github.com/remorses/playwriter'

export function HeroSection() {
  const [fontsReady, setFontsReady] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFontsReady(true)
    }, 3000)
    void document.fonts.ready.then(() => {
      setFontsReady(true)
    })
    return () => {
      clearTimeout(timeout)
    }
  }, [])

  return (
    <div className='relative mt-4 lg:mt-8 mb-6 lg:mb-10 w-full flex flex-col items-center overflow-hidden'>
      <HeroBackground />

      {/* Foreground content */}
      <div
        className='relative z-[2] flex flex-col items-center justify-center text-center max-w-[820px] mx-auto w-full px-5 py-8 sm:py-10 lg:py-12 gap-4'
        style={{
          opacity: fontsReady ? 1 : 0,
          transition: 'opacity 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <h1
          className='flex flex-col items-center leading-[1.1] text-[32px] sm:text-[42px] md:text-[52px] text-foreground'
          style={{ fontFamily: HERO_FONT }}
        >
          <span>let agents control</span>
          <span>your Chrome browser</span>
        </h1>

        {/* CTA buttons */}
        <div className='flex gap-2.5 flex-wrap justify-center'>
          <a
            href={CHROME_EXTENSION_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-2 rounded-md bg-white text-black backdrop-blur-sm h-9 px-4 text-sm font-medium no-underline hover:opacity-90 transition-opacity cursor-pointer'
          >
            <ChromeIcon size={16} />
            Get Chrome Extension
          </a>
          <a
            href={GITHUB_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-2 rounded-md backdrop-blur-sm h-9 px-4 text-sm font-medium text-foreground no-underline hover:bg-accent/50 transition-colors cursor-pointer'
          >
            <GithubIcon size={14} />
            GitHub
          </a>
        </div>

        {/* 4.7 star rating */}
        <StarRating rating={4.7} />
      </div>
    </div>
  )
}

export function ChangelogHeroSection() {
  return (
    <div className='relative z-0 mt-4 lg:mt-8 mb-6 lg:mb-10 w-screen ml-[calc(-50vw+50%)] flex flex-col items-center overflow-hidden'>
      <HeroBackground dotColor='rgba(100, 140, 255, 0.7)' />

      <div className='relative z-[2] flex flex-col items-center justify-center text-center px-6 py-8 sm:py-10 lg:py-12'>
        <h1
          className='leading-[1.1] text-[32px] sm:text-[42px] md:text-[52px] text-foreground'
          style={{ fontFamily: HERO_FONT }}
        >
          changelog
        </h1>
      </div>
    </div>
  )
}

export function CloudHeroSection() {
  const [fontsReady, setFontsReady] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFontsReady(true)
    }, 3000)
    void document.fonts.ready.then(() => {
      setFontsReady(true)
    })
    return () => {
      clearTimeout(timeout)
    }
  }, [])

  return (
    <div className='relative mt-4 lg:mt-8 mb-6 lg:mb-10 w-full flex flex-col items-center overflow-hidden'>
      <HeroBackground dotColor='rgba(255, 50, 50, 0.7)' />

      {/* Foreground content */}
      <div
        className='relative z-[2] flex flex-col items-center justify-center text-center max-w-[820px] mx-auto w-full px-5 py-8 sm:py-10 lg:py-12 gap-4'
        style={{
          opacity: fontsReady ? 1 : 0,
          transition: 'opacity 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <h1
          className='flex flex-col items-center leading-[1.1] text-[32px] sm:text-[42px] md:text-[52px] text-foreground'
          style={{ fontFamily: HERO_FONT }}
        >
          <span>stealth browsers that</span>
          <span>bypass bot detection</span>
        </h1>

        {/* CTA button */}
        <div className='flex gap-2.5 flex-wrap justify-center'>
          <a
            href='/login'
            className='inline-flex items-center gap-2 rounded-md bg-white text-black backdrop-blur-sm h-9 px-4 text-sm font-medium no-underline hover:opacity-90 transition-opacity cursor-pointer'
          >
            <GoogleIcon size={16} />
            Login with Google
          </a>
        </div>

        {/* 4.7 star rating */}
        <StarRating rating={4.7} />
      </div>
    </div>
  )
}
