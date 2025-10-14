"use client"

import Image from 'next/image'

export function Greeting() {
  return (
    <div className="w-full flex flex-col justify-center items-center min-h-[60vh] relative">
      <div className="relative z-10 flex flex-col items-center">
        <div className="text-4xl font-bold animate-fade-in animation-delay-200 text-center mb-8">
          <span className="bg-gradient-to-r from-blue-600 via-primary to-secondary bg-clip-text text-transparent">
            Strands Agent
          </span>
        </div>
        <div className="animate-fade-in animation-delay-300 self-end flex items-center gap-2">
          <span className="text-base text-gray-500 font-medium">powered by</span>
          <Image
            src="/logo_AWS.svg"
            alt="AWS"
            width={65}
            height={29}
            className="opacity-70 hover:opacity-90 transition-opacity duration-300"
            priority
          />
        </div>
      </div>
    </div>
  )
}
