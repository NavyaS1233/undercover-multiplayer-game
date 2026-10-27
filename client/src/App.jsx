import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '');
const socket = io(SERVER_URL, { autoConnect: false });

export default function App() {
  const [name, setName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [game, setGame] = useState(null);
  const [secretWord, setSecretWord] = useState('');
  const [clue, setClue] = useState('');
  const [selectedVote, setSelectedVote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [showWord, setShowWord] = useState(true);
  const previousRoundRef = useRef(0);

  useEffect(() => {
    const onCreated = ({ roomCode: code, playerId: id }) => { setRoomCode(code); setPlayerId(id); setError(''); };
    const onJoined = ({ roomCode: code, playerId: id }) => { setRoomCode(code); setPlayerId(id); setError(''); };
    const onState = (state) => {
      if (state.roundNumber !== previousRoundRef.current) {
        previousRoundRef.current = state.roundNumber;
        setClue('');
        setSelectedVote('');
        setNotice('');
      }
      setGame(state);
    };
    const onWord = (data) => { setSecretWord(data.word); setShowWord(true); };
    const onError = ({ message }) => { setNotice(''); setError(message || 'Something went wrong.'); };
    const onAccepted = () => { setNotice('Clue submitted successfully.'); setError(''); };
    const onRoundResults = (data) => { setResult(data); setNotice(data.summary?.message || 'Round complete.'); };
    const onStarted = () => { setResult(null); setNotice('Game started! Your secret word is ready.'); };
    socket.on('room:created', onCreated);
    socket.on('room:joined', onJoined);
    socket.on('game:state', onState);
    socket.on('word:private', onWord);
    socket.on('game:error', onError);
    socket.on('clue:rejected', onError);
    socket.on('clue:accepted', onAccepted);
    socket.on('round:results', onRoundResults);
    socket.on('game:started', onStarted);
    return () => {
      socket.off('room:created', onCreated); socket.off('room:joined', onJoined);
      socket.off('game:state', onState); socket.off('word:private', onWord);
      socket.off('game:error', onError); socket.off('clue:rejected', onError);
      socket.off('clue:accepted', onAccepted); socket.off('round:results', onRoundResults);
      socket.off('game:started', onStarted);
    };
  }, []);

  const me = useMemo(() => game?.players.find(p => p.id === playerId), [game, playerId]);
  const alreadyClued = Boolean(game?.clues && Object.hasOwn(game.clues, playerId));
  const alreadyVoted = Boolean(game?.phase === 'VOTING' && selectedVote && false); // Server remains authoritative.
  const alreadyVotedByCount = Boolean(game?.phase === 'VOTING' && notice === 'Vote submitted.');

  function connectIfNeeded() {
    if (!SERVER_URL) { setError('The game server URL is not configured. Please contact the site owner.'); return false; }
    if (!socket.connected) socket.connect();
    return true;
  }
  function createRoom() { setError(''); setNotice(''); if (!name.trim()) return setError('Please enter your name first.'); if (connectIfNeeded()) socket.emit('room:create', { name }); }
  function joinRoom() { setError(''); setNotice(''); if (!name.trim() || !roomCodeInput.trim()) return setError('Enter your name and room code.'); if (connectIfNeeded()) socket.emit('room:join', { name, roomCode: roomCodeInput }); }
  function startGame() { setError(''); socket.emit('game:start'); }
  function submitClue() { setError(''); setNotice(''); socket.emit('clue:submit', { clue }); }
  function submitVote() { if (!selectedVote) return setError('Choose a player first.'); setError(''); socket.emit('vote:submit', { targetPlayerId: selectedVote }); setNotice('Vote submitted.'); }
  async function copyCode() { try { await navigator.clipboard.writeText(roomCode); setNotice('Room code copied!'); } catch { setNotice(`Share this room code: ${roomCode}`); } }

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark">U</div><div><div className="brand">UNDERCOVER</div><div className="tagline">One word. One imposter. Trust no one.</div></div>{roomCode && <button className="room-pill" onClick={copyCode}>ROOM {roomCode} · COPY</button>}</header>
    {!game ? <section className="hero panel"><div className="eyebrow">🎭 REAL-TIME PARTY GAME</div><h1>Can you spot<br/><span>the Imposter?</span></h1><p className="muted">Join your friends, give clever clues, and figure out who has a different secret word.</p><label>Your nickname</label><input value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="e.g. Navya" />
      <div className="action-grid"><button className="primary" onClick={createRoom}>＋ Create a room</button><div className="join-row"><input value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.toUpperCase())} maxLength={6} placeholder="ROOM CODE"/><button className="secondary" onClick={joinRoom}>Join</button></div></div><div className="rule-note">No account needed · 3–20 players · Works on mobile and desktop</div></section>
      : <div className="game-layout"><section className="panel game-main">
        {game.phase === 'LOBBY' && <><div className="eyebrow">ROOM {game.roomCode}</div><h2>Waiting room</h2><p className="muted">Share the room code with your friends.</p><div className="room-code-large" onClick={copyCode}>{game.roomCode}<span>↗</span></div><div className="player-list">{game.players.map((p, i) => <div className="player-row" key={p.id}><div className="avatar">{p.name.slice(0,1).toUpperCase()}</div><span>{p.name}{p.id === game.hostPlayerId ? ' 👑' : ''}{p.id === playerId ? ' (you)' : ''}</span><span className={p.connected ? 'online-dot' : 'offline-dot'} /></div>)}</div>{game.isHost ? <button className="primary full" disabled={game.players.filter(p => p.connected).length < 3} onClick={startGame}>Start game · {game.players.length} players</button> : <div className="waiting"><span className="pulse"/> Waiting for the host to start…</div>}{game.players.length < 3 && <p className="small muted">At least 3 connected players are needed.</p>}</>}
        {game.phase !== 'LOBBY' && <><div className="eyebrow">ROUND {game.roundNumber} · {game.phase.replace('_',' ')}</div><h2>{game.phase === 'CLUE_PHASE' ? 'Give one clue' : game.phase === 'VOTING' ? 'Who is the Imposter?' : game.phase === 'GAME_OVER' ? 'Game over' : 'Round results'}</h2>
          {game.phase !== 'GAME_OVER' && <div className="secret-card"><div className="secret-label">YOUR SECRET WORD</div><div className="secret-word">{showWord ? (secretWord || '••••••') : '••••••'}</div><button className="text-button" onClick={() => setShowWord(!showWord)}>{showWord ? 'Hide word' : 'Show word'}</button><p className="small">Keep your word secret. Only you can see it.</p></div>}
          {game.phase === 'CLUE_PHASE' && <><p className="muted">Describe your word without saying it directly. Used clues cannot be repeated in later rounds.</p><div className="clue-form"><input value={clue} onChange={e => setClue(e.target.value)} maxLength={30} disabled={alreadyClued} placeholder="One word only…" onKeyDown={e => e.key === 'Enter' && !alreadyClued && submitClue()}/><button className="primary" disabled={alreadyClued} onClick={submitClue}>{alreadyClued ? 'Submitted ✓' : 'Submit clue'}</button></div><div className="small muted">Clues submitted: {Object.keys(game.clues || {}).length}/{game.players.filter(p => p.connected).length}</div></>}
          {game.phase === 'VOTING' && <><div className="clue-board">{game.players.map(p => <div className="clue-row" key={p.id}><span>{p.name}{p.id === playerId ? ' (you)' : ''}</span><strong>{game.clues?.[p.id] || '—'}</strong></div>)}</div><p className="muted">Select one other player. Votes are counted when everyone has voted.</p><div className="vote-list">{game.players.filter(p => p.connected && p.id !== playerId).map(p => <button key={p.id} className={`vote-option ${selectedVote === p.id ? 'selected' : ''}`} onClick={() => setSelectedVote(p.id)}><span className="avatar tiny">{p.name.slice(0,1).toUpperCase()}</span>{p.name}<span className="radio-dot"/></button>)}</div><button className="primary full" onClick={submitVote} disabled={!selectedVote || alreadyVotedByCount}>Submit vote</button><p className="small muted">Votes submitted: {game.votesSubmitted}/{game.players.filter(p => p.connected).length}</p></>}
          {game.phase === 'GAME_OVER' && <div className="result-card"><div className="result-emoji">🎭</div><h3>The Imposter was found!</h3><p className="muted">The players win this game.</p><p>Main word: <b>{game.result?.mainWord}</b></p><p>Imposter word: <b>{game.result?.imposterWord}</b></p><p>Imposter: <b>{game.players.find(p => p.id === game.result?.imposterPlayerId)?.name || 'Unknown'}</b></p><div className="score-list">{[...(game.players || [])].sort((a,b) => b.score-a.score).map(p => <div className="score-row" key={p.id}><span>{p.name}</span><b>{p.score} pts</b></div>)}</div><button className="secondary full" onClick={() => window.location.reload()}>Back to home</button></div>}
        </>}
      </section><aside className="panel side-panel"><div className="side-heading">PLAYERS <span>{game.players.length}</span></div>{game.players.map(p => <div className="mini-player" key={p.id}><div className="avatar tiny">{p.name.slice(0,1).toUpperCase()}</div><div className="mini-name">{p.name}{p.id === game.hostPlayerId && <small>HOST</small>}</div><b>{p.score}</b></div>)}<div className="side-tip"><span>✦</span><div><b>Quick tip</b><p>Be specific enough to sound convincing, but vague enough to stay safe.</p></div></div>{game.lastRoundSummary && <div className="previous-result"><b>Previous round</b><p>{game.lastRoundSummary.message}</p><small>Round {game.lastRoundSummary.roundNumber}</small></div>}</aside></div>}
    {(error || notice) && <div className={`toast ${error ? 'error' : ''}`} role="status">{error || notice}<button onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
    <footer>UNDERCOVER <span>·</span> A social deduction game</footer>
  </main>;
}
