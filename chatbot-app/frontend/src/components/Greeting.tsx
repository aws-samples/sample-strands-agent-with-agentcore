"use client"

export function Greeting() {
  return (
    <div className="w-full flex flex-col justify-center items-center min-h-[60vh] relative">
      <div className="relative z-10">
        <div className="text-4xl font-bold animate-fade-in text-balance text-center">
          Welcome to{" "}
          <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
            Strands Agent
          </span>
        </div>
      </div>
    </div>
  )
}
