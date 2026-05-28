/**
 * ISP Violation Fixture — fat interface with partial implementation.
 */
export interface MediaPlayer {
  play(): void;
  pause(): void;
  stop(): void;
  next(): void;
  previous(): void;
  setVolume(level: number): void;
  getCurrentTrack(): string;
  getPlaylist(): string[];
  shuffle(): void;
  repeat(): void;
}

/**
 * A class that implements MediaPlayer but throws on several methods.
 */
export class BasicAudioPlayer implements MediaPlayer {
  private currentTrack = '';
  private volume = 50;

  play(): void {
    console.log('Playing...');
  }

  pause(): void {
    console.log('Paused');
  }

  stop(): void {
    console.log('Stopped');
  }

  next(): void {
    throw new NotImplementedError('Next track not available in basic player');
  }

  previous(): void {
    throw new NotImplementedError('Previous track not available in basic player');
  }

  setVolume(level: number): void {
    this.volume = level;
  }

  getCurrentTrack(): string {
    return this.currentTrack;
  }

  getPlaylist(): string[] {
    throw new NotImplementedError('Playlist not available in basic player');
  }

  shuffle(): void {
    throw new NotImplementedError('Shuffle not available in basic player');
  }

  repeat(): void {
    throw new NotImplementedError('Repeat not available in basic player');
  }
}

class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
