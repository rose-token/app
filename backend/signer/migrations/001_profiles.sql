-- Create profiles table for storing user profile data
CREATE TABLE IF NOT EXISTS profiles (
  address VARCHAR(42) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  bio TEXT,
  avatar VARCHAR(200),
  skills TEXT[],
  github VARCHAR(100),
  twitter VARCHAR(100),
  website VARCHAR(200),
  signature TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for skill-based lookups
CREATE INDEX IF NOT EXISTS idx_profiles_skills ON profiles USING GIN(skills);

-- Index for recently updated profiles
CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles(updated_at DESC);
