"use client"

import { useState, useEffect } from 'react'

const GREETINGS = [
  "Hello, creator",
  "Ready to build?",
  "Your AI companion",
  "Let's explore",
  "Ideas welcome"
]

export function Greeting() {
  const [greeting, setGreeting] = useState("")

  useEffect(() => {
    // Pick a random greeting on component mount
    const randomIndex = Math.floor(Math.random() * GREETINGS.length)
    setGreeting(GREETINGS[randomIndex])
  }, [])

  return (
    <div className="w-full flex flex-col justify-center items-center">
      <div className="relative z-10">
        <div className="text-4xl md:text-5xl font-bold animate-fade-in text-balance text-center">
          <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
            {greeting}
          </span>
        </div>
      </div>
    </div>
  )
}
