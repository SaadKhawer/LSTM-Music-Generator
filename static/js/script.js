document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const btnInitEngine = document.getElementById('btn-init-engine');
    const engineStatus = document.getElementById('engine-status');
    const selectModelWeights = document.getElementById('select-model-weights');
    const inputSongTitle = document.getElementById('input-song-title');
    const btnStartComposition = document.getElementById('btn-start-composition');
    const songsListTbody = document.getElementById('songs-list-tbody');
    const songsCountLabel = document.getElementById('songs-count-label');
    const selectMusicGenre = document.getElementById('select-music-genre');
    
    // Player Controls
    const masterPlayPause = document.getElementById('master-play-pause');
    const playerTrackName = document.getElementById('player-track-name');
    const playerTrackArtist = document.getElementById('player-track-artist');
    const playerModelBadge = document.getElementById('player-model-badge');
    const trackProgress = document.getElementById('track-progress');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');
    const timelineContainer = document.getElementById('timeline-container');
    const cardVisualizer = document.getElementById('card-visualizer');
    const actionDownloadLink = document.getElementById('action-download-link');
    
    const btnShuffle = document.getElementById('btn-shuffle');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnLoop = document.getElementById('btn-loop');
    const btnMute = document.getElementById('btn-mute');
    const volumeSliderContainer = document.getElementById('volume-slider-container');
    const volumeProgress = document.getElementById('volume-progress');

    // Sidebar navigation links (just for visuals or page scroll)
    const navHome = document.getElementById('nav-home');
    const navLibrary = document.getElementById('nav-library');
    
    // Preprocessing button
    const trainPlayBtn = document.getElementById('train-play-btn');

    // --- State Variables ---
    let audioCtx = null;
    let synth = null;
    let midiPlayer = null;
    
    let isPlaying = false;
    let activeTrack = null;
    let songsList = [];
    
    let isShuffleEnabled = false;
    let isLoopEnabled = false;
    let currentVolume = 0.75;
    let isMuted = false;
    let savedVolume = 0.75;

    // --- Toast Notification System ---
    function showToast(message, isError = false) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        
        if (isError) {
            toast.style.borderColor = '#ef4444';
            toast.style.boxShadow = '0 10px 30px rgba(239, 68, 68, 0.3)';
        } else {
            toast.style.borderColor = '#8b5cf6';
            toast.style.boxShadow = '0 10px 30px rgba(139, 92, 246, 0.3)';
        }
        
        toast.classList.remove('hidden');
        
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 5000);
    }

    // --- Fallback Synth (Plays sine waves if Soundfont loading fails or offline) ---
    class FallbackSynth {
        constructor(ctx) {
            this.ctx = ctx;
            this.activeNodes = {};
        }
        
        play(noteName, time, options) {
            const freq = this.noteNameToFreq(noteName);
            if (!freq) return;
            
            this.stop(noteName);
            
            const osc = this.ctx.createOscillator();
            const gainNode = this.ctx.createGain();
            
            // Warm triangle sound
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, time || this.ctx.currentTime);
            
            // Quick attack, smooth decay
            const volume = (options && options.gain !== undefined) ? options.gain : 0.2;
            const now = time || this.ctx.currentTime;
            
            gainNode.gain.setValueAtTime(0.001, now);
            gainNode.gain.linearRampToValueAtTime(volume * 0.4, now + 0.02);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
            
            osc.connect(gainNode);
            gainNode.connect(this.ctx.destination);
            
            osc.start(now);
            osc.stop(now + 1.3);
            
            this.activeNodes[noteName] = { osc, gainNode };
        }
        
        stop(noteName) {
            const node = this.activeNodes[noteName];
            if (node) {
                try {
                    const now = this.ctx.currentTime;
                    node.gainNode.gain.cancelScheduledValues(now);
                    node.gainNode.gain.setValueAtTime(node.gainNode.gain.value, now);
                    node.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
                    node.osc.stop(now + 0.08);
                } catch(e) {}
                delete this.activeNodes[noteName];
            }
        }
        
        noteNameToFreq(note) {
            const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const match = note.match(/^([A-G]#?)(\d+)$/);
            if (!match) return null;
            const name = match[1];
            const octave = parseInt(match[2], 10);
            const keyNumber = notes.indexOf(name) + (octave - 4) * 12;
            return 440 * Math.pow(2, keyNumber / 12);
        }
    }

    // --- Audio Engine Initialization ---
    async function initAudioEngine() {
        if (audioCtx) return true; // Already initialized
        
        engineStatus.textContent = "Connecting Audio...";
        engineStatus.className = "engine-offline";
        
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Initialize MIDI player
            midiPlayer = new MidiPlayer.Player(function(event) {
                if (event.name === 'Note on') {
                    if (event.velocity > 0) {
                        const vol = (event.velocity / 127) * (isMuted ? 0 : currentVolume);
                        if (activeTrack && activeTrack.genre === 'phonk') {
                            playPhonkNote(event.noteName, event.noteNumber, event.channel, vol);
                        } else if (synth) {
                            synth.play(event.noteName, audioCtx.currentTime, { gain: vol });
                        }
                    } else {
                        if (activeTrack && activeTrack.genre === 'phonk') {
                            stopPhonkNote(event.noteName, event.channel);
                        } else if (synth && typeof synth.stop === 'function') {
                            synth.stop(event.noteName);
                        }
                    }
                } else if (event.name === 'Note off') {
                    if (activeTrack && activeTrack.genre === 'phonk') {
                        stopPhonkNote(event.noteName, event.channel);
                    } else if (synth && typeof synth.stop === 'function') {
                        synth.stop(event.noteName);
                    }
                }
            });

            // Set up player events
            midiPlayer.on('playing', () => {
                const elapsed = midiPlayer.getSongTime();
                const remaining = midiPlayer.getSongTimeRemaining();
                const total = elapsed + remaining;
                
                // Update progress
                const percent = 100 - midiPlayer.getSongPercentRemaining();
                trackProgress.style.width = `${percent}%`;
                
                currentTimeEl.textContent = formatTime(elapsed);
                totalTimeEl.textContent = formatTime(total);
            });

            midiPlayer.on('endOfFile', () => {
                isPlaying = false;
                masterPlayPause.innerHTML = '<i class="ph-fill ph-play"></i>';
                cardVisualizer.classList.add('hidden');
                trackProgress.style.width = '0%';
                currentTimeEl.textContent = '0:00';
                
                if (isLoopEnabled) {
                    midiPlayer.stop();
                    midiPlayer.play();
                    isPlaying = true;
                    masterPlayPause.innerHTML = '<i class="ph-fill ph-pause"></i>';
                    cardVisualizer.classList.remove('hidden');
                } else {
                    playNextTrack();
                }
            });
            
            // Try loading Soundfont instrument
            engineStatus.textContent = "Loading Soundfont...";
            try {
                synth = await Soundfont.instrument(audioCtx, 'acoustic_grand_piano', {
                    soundfont: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/'
                });
                engineStatus.textContent = "Ready (Piano Synth)";
                engineStatus.className = "engine-online";
                btnInitEngine.style.display = "none";
                showToast("Audio Engine successfully loaded piano samples!");
            } catch(e) {
                console.warn("Failed to load online soundfont, falling back to clean local synthesizer.", e);
                synth = new FallbackSynth(audioCtx);
                engineStatus.textContent = "Ready (Synth Fallback)";
                engineStatus.className = "engine-online";
                btnInitEngine.style.display = "none";
                showToast("Offline fallback active: local synth loaded successfully.");
            }
            
            return true;
        } catch(err) {
            console.error("Failed to setup audio engine", err);
            engineStatus.textContent = "Init Error";
            engineStatus.className = "engine-error";
            showToast("Failed to initialize audio engine. Check browser Audio settings.", true);
            return false;
        }
    }

    btnInitEngine.addEventListener('click', initAudioEngine);

    // --- Helper: Format seconds into mm:ss ---
    function formatTime(secs) {
        if (isNaN(secs)) return '0:00';
        const minutes = Math.floor(secs / 60);
        const seconds = Math.floor(secs % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    // --- API: Fetch Available Models ---
    async function fetchModels() {
        try {
            const response = await fetch('/api/models');
            const data = await response.json();
            
            if (response.ok && data.status === 'success') {
                selectModelWeights.innerHTML = '';
                data.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    // Pretty label
                    if (model === 'final_model.keras') {
                        option.textContent = 'Chopin Piano Final Model (Recommended)';
                    } else {
                        // Extract details from name if weights-improvement-epoch-loss.keras
                        const parts = model.split('-');
                        if (parts.length >= 3) {
                            const epoch = parseInt(parts[2]);
                            const loss = parts[3] ? parts[3].replace('.keras', '') : '';
                            option.textContent = `Checkpoint Epoch ${epoch} (Loss: ${loss})`;
                        } else {
                            option.textContent = model;
                        }
                    }
                    selectModelWeights.appendChild(option);
                });
            } else {
                showToast("Failed to fetch model weights from backend.", true);
            }
        } catch (error) {
            console.error(error);
            showToast("Error connecting to weights endpoint.", true);
        }
    }

    // --- API: Fetch Library Songs ---
    async function fetchSongs(autoPlayId = null) {
        try {
            const response = await fetch('/api/songs');
            const data = await response.json();
            
            if (response.ok && data.status === 'success') {
                songsList = data.songs;
                songsCountLabel.textContent = `${songsList.length} Tracks Available`;
                renderSongsTable(autoPlayId);
            } else {
                showToast("Failed to retrieve your compositions.", true);
            }
        } catch(error) {
            console.error(error);
            showToast("Error connecting to compositions endpoint.", true);
        }
    }

    // --- Render Songs Table ---
    function renderSongsTable(autoPlayId = null) {
        songsListTbody.innerHTML = '';
        
        if (songsList.length === 0) {
            songsListTbody.innerHTML = `
                <tr>
                    <td colspan="6" class="loading-placeholder">
                        <i class="ph ph-music-notes-simple" style="font-size: 2rem; display: block; margin-bottom: 8px;"></i>
                        No compositions found. Enter a title above and generate one!
                    </td>
                </tr>
            `;
            return;
        }

        songsList.forEach((song, index) => {
            const tr = document.createElement('tr');
            tr.id = `song-row-${song.id}`;
            
            if (activeTrack && activeTrack.id === song.id) {
                tr.className = 'active-playing-row';
            }

            // Click row to play
            tr.addEventListener('click', () => {
                playTrack(song);
            });

            // Action row buttons
            const actionTds = document.createElement('td');
            actionTds.className = 'row-action-btns';
            
            const btnDownload = document.createElement('a');
            btnDownload.href = song.file;
            btnDownload.className = 'row-btn-download';
            btnDownload.title = 'Download MIDI';
            btnDownload.innerHTML = '<i class="ph ph-download-simple"></i>';
            btnDownload.setAttribute('download', '');
            btnDownload.addEventListener('click', (e) => {
                e.stopPropagation(); // Don't trigger play
            });
            actionTds.appendChild(btnDownload);

            if (song.type === 'generated') {
                const btnDelete = document.createElement('button');
                btnDelete.className = 'row-btn-delete';
                btnDelete.title = 'Delete Song';
                btnDelete.innerHTML = '<i class="ph ph-trash"></i>';
                btnDelete.addEventListener('click', (e) => {
                    e.stopPropagation(); // Don't trigger play
                    deleteTrack(song);
                });
                actionTds.appendChild(btnDelete);
            }

            tr.innerHTML = `
                <td style="width: 50px; text-align: center;">
                    <button class="table-play-btn"><i class="${activeTrack && activeTrack.id === song.id && isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'}"></i></button>
                </td>
                <td style="font-weight: 700; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${song.title}</td>
                <td style="color: var(--text-muted);">${song.artist}</td>
                <td style="color: var(--text-muted); font-size: 0.8rem; font-family: monospace;">${song.model}</td>
                <td style="color: var(--text-muted); font-size: 0.85rem;">${song.date}</td>
            `;
            
            tr.appendChild(actionTds);
            songsListTbody.appendChild(tr);
        });

        // Trigger autoplay if requested
        if (autoPlayId) {
            const newTrack = songsList.find(s => s.id === autoPlayId);
            if (newTrack) {
                playTrack(newTrack);
            }
        }
    }

    // --- Highlights active playing row in table ---
    function updateActiveRowInTable(activeId) {
        const rows = songsListTbody.querySelectorAll('tr');
        rows.forEach(row => {
            row.classList.remove('active-playing-row');
            const playIcon = row.querySelector('.table-play-btn i');
            if (playIcon) {
                playIcon.className = 'ph-fill ph-play';
            }
        });

        const activeRow = document.getElementById(`song-row-${activeId}`);
        if (activeRow) {
            activeRow.classList.add('active-playing-row');
            const playIcon = activeRow.querySelector('.table-play-btn i');
            if (playIcon) {
                playIcon.className = isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
            }
        }
    }

    // --- Play Track Engine ---
    async function playTrack(song) {
        // Init engine on first user click if not active
        if (!audioCtx || !midiPlayer) {
            const success = await initAudioEngine();
            if (!success) return;
        }

        // If clicking the currently playing track, toggle play/pause
        if (activeTrack && activeTrack.id === song.id) {
            togglePlayPause();
            return;
        }

        try {
            // Stop old track
            if (midiPlayer) {
                midiPlayer.stop();
            }
            isPlaying = false;
            
            // Resume Audio Context if suspended
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }

            showToast(`Loading: ${song.title}...`);
            
            // Fetch MIDI file
            const res = await fetch(song.file);
            if (!res.ok) throw new Error("Could not fetch MIDI file from server");
            const ab = await res.arrayBuffer();
            
            // Load and Play
            midiPlayer.loadArrayBuffer(ab);
            midiPlayer.play();
            
            isPlaying = true;
            activeTrack = song;

            // Update UI
            playerTrackName.textContent = song.title;
            playerTrackArtist.textContent = song.artist;
            playerModelBadge.textContent = song.model || 'Demo';
            actionDownloadLink.href = song.file;
            actionDownloadLink.classList.remove('hidden');
            masterPlayPause.innerHTML = '<i class="ph-fill ph-pause"></i>';
            cardVisualizer.classList.remove('hidden');
            
            updateActiveRowInTable(song.id);
        } catch(err) {
            console.error(err);
            showToast(`Playback Error: ${err.message}`, true);
        }
    }

    // --- Toggle Play / Pause ---
    function togglePlayPause() {
        if (!activeTrack) {
            // Play first track if nothing active
            if (songsList.length > 0) {
                playTrack(songsList[0]);
            } else {
                showToast("Compositions library is empty! Generate a song first.", true);
            }
            return;
        }

        if (!midiPlayer) return;

        if (isPlaying) {
            midiPlayer.pause();
            isPlaying = false;
            masterPlayPause.innerHTML = '<i class="ph-fill ph-play"></i>';
            cardVisualizer.classList.add('hidden');
        } else {
            // Resume Audio Context
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            midiPlayer.play();
            isPlaying = true;
            masterPlayPause.innerHTML = '<i class="ph-fill ph-pause"></i>';
            cardVisualizer.classList.remove('hidden');
        }
        updateActiveRowInTable(activeTrack.id);
    }

    masterPlayPause.addEventListener('click', togglePlayPause);

    // --- Skip / Seekbar Navigation ---
    timelineContainer.addEventListener('click', (e) => {
        if (!midiPlayer || !midiPlayer.totalTicks) return;
        
        const rect = timelineContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, clickX / rect.width));
        const targetTick = Math.floor(percent * midiPlayer.totalTicks);
        
        midiPlayer.skipToTick(targetTick);
        
        // Update bar manually if paused
        if (!isPlaying) {
            trackProgress.style.width = `${percent * 100}%`;
            const elapsed = midiPlayer.getSongTime();
            currentTimeEl.textContent = formatTime(elapsed);
        }
    });

    // --- Play Next / Prev Tracks ---
    function playNextTrack() {
        if (songsList.length === 0) return;
        
        let nextIndex = 0;
        if (isShuffleEnabled) {
            nextIndex = Math.floor(Math.random() * songsList.length);
        } else if (activeTrack) {
            const curIdx = songsList.findIndex(s => s.id === activeTrack.id);
            nextIndex = (curIdx + 1) % songsList.length;
        }
        playTrack(songsList[nextIndex]);
    }

    function playPrevTrack() {
        if (songsList.length === 0) return;
        
        let prevIndex = 0;
        if (activeTrack) {
            const curIdx = songsList.findIndex(s => s.id === activeTrack.id);
            prevIndex = (curIdx - 1 + songsList.length) % songsList.length;
        }
        playTrack(songsList[prevIndex]);
    }

    btnNext.addEventListener('click', playNextTrack);
    btnPrev.addEventListener('click', playPrevTrack);

    // --- Repeat & Shuffle buttons ---
    btnLoop.addEventListener('click', () => {
        isLoopEnabled = !isLoopEnabled;
        btnLoop.classList.toggle('active-toggle', isLoopEnabled);
        showToast(isLoopEnabled ? "Repeat active: track will loop indefinitely." : "Repeat disabled.");
    });

    btnShuffle.addEventListener('click', () => {
        isShuffleEnabled = !isShuffleEnabled;
        btnShuffle.classList.toggle('active-toggle', isShuffleEnabled);
        showToast(isShuffleEnabled ? "Shuffle active: next songs will play randomly." : "Shuffle disabled.");
    });

    // --- Volume Controller ---
    volumeSliderContainer.addEventListener('click', (e) => {
        const rect = volumeSliderContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, clickX / rect.width));
        
        currentVolume = percent;
        isMuted = false;
        volumeProgress.style.width = `${percent * 100}%`;
        
        updateVolumeIcon();
    });

    btnMute.addEventListener('click', () => {
        if (isMuted) {
            currentVolume = savedVolume;
            isMuted = false;
            volumeProgress.style.width = `${currentVolume * 100}%`;
        } else {
            savedVolume = currentVolume;
            currentVolume = 0;
            isMuted = true;
            volumeProgress.style.width = '0%';
        }
        updateVolumeIcon();
    });

    function updateVolumeIcon() {
        if (isMuted || currentVolume === 0) {
            btnMute.innerHTML = '<i class="ph ph-speaker-simple-x"></i>';
        } else if (currentVolume < 0.35) {
            btnMute.innerHTML = '<i class="ph ph-speaker-simple-low"></i>';
        } else {
            btnMute.innerHTML = '<i class="ph ph-speaker-simple-high"></i>';
        }
    }

    // --- API: Generate Music ---
    async function handleGenerate() {
        const title = inputSongTitle.value.trim();
        const weights = selectModelWeights.value;

        // Init audio context automatically on composition so user is ready to listen
        if (!audioCtx) {
            await initAudioEngine();
        }

        // Show UI Loading Composing State
        btnStartComposition.disabled = true;
        btnStartComposition.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Composing notes...';
        showToast("Generating music note-by-note. This takes about 10-15 seconds for the LSTM Network...");

        try {
            const response = await fetch('/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    song_title: title,
                    model_weights: weights,
                    genre: selectMusicGenre.value
                })
            });
            const data = await response.json();

            if (response.ok && data.status === 'success') {
                showToast(data.message);
                inputSongTitle.value = ''; // Reset input
                
                // Get filename from path or API response
                const filename = data.file.split('/').pop();
                
                // Fetch list and autoplay the new composition!
                await fetchSongs(filename);
            } else {
                showToast(data.message || "Failed to generate composition.", true);
            }
        } catch(error) {
            console.error(error);
            showToast("Server connection error during composition.", true);
        } finally {
            btnStartComposition.disabled = false;
            btnStartComposition.innerHTML = '<i class="ph-bold ph-sparkle"></i> Compose Masterpiece';
        }
    }

    btnStartComposition.addEventListener('click', handleGenerate);

    // --- API: Delete Track ---
    async function deleteTrack(song) {
        if (!confirm(`Are you sure you want to delete '${song.title}'?`)) return;

        try {
            const response = await fetch(`/api/songs/${song.filename}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (response.ok && data.status === 'success') {
                showToast(data.message);
                
                // Stop player if deleting currently active track
                if (activeTrack && activeTrack.id === song.id) {
                    if (midiPlayer) midiPlayer.stop();
                    isPlaying = false;
                    activeTrack = null;
                    playerTrackName.textContent = 'Select a track';
                    playerTrackArtist.textContent = 'Symphony AI Composer';
                    playerModelBadge.textContent = 'No Model Active';
                    masterPlayPause.innerHTML = '<i class="ph-fill ph-play"></i>';
                    cardVisualizer.classList.add('hidden');
                    actionDownloadLink.classList.add('hidden');
                    trackProgress.style.width = '0%';
                    currentTimeEl.textContent = '0:00';
                    totalTimeEl.textContent = '0:00';
                }

                // Refresh table
                fetchSongs();
            } else {
                showToast(data.message || "Failed to delete track.", true);
            }
        } catch(error) {
            console.error(error);
            showToast("Error connecting to delete endpoint.", true);
        }
    }

    // --- API: Run Preprocessing ---
    async function handleTrain() {
        trainPlayBtn.disabled = true;
        trainPlayBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
        showToast("Starting neural preprocessor...");

        try {
            const response = await fetch('/train', { method: 'POST' });
            const data = await response.json();

            if (response.ok) {
                showToast(data.message);
                document.getElementById('preprocess-status').textContent = "Dataset Preprocessed! Run local training via CLI.";
            } else {
                showToast(data.message, true);
            }
        } catch (error) {
            showToast("Failed to communicate with training backend.", true);
        } finally {
            trainPlayBtn.disabled = false;
            trainPlayBtn.innerHTML = '<i class="ph-fill ph-lightning"></i>';
        }
    }

    trainPlayBtn.addEventListener('click', handleTrain);

    // --- Music Genre Change Event ---
    if (selectMusicGenre) {
        selectMusicGenre.addEventListener('change', () => {
            if (selectMusicGenre.value === 'phonk') {
                selectModelWeights.disabled = true;
                selectModelWeights.style.opacity = '0.5';
            } else {
                selectModelWeights.disabled = false;
                selectModelWeights.style.opacity = '1.0';
            }
        });
    }

    // --- Phonk Drum and Synthesizer Engine ---
    let activePhonkNodes = {};

    function playPhonkNote(noteName, noteNumber, channel, volume) {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        
        // Handle drums
        if (channel === 10 || noteNumber === 36 || noteNumber === 38 || noteNumber === 42) {
            if (noteNumber === 36) {
                synthesizeKick(now, volume);
            } else if (noteNumber === 38) {
                synthesizeSnare(now, volume);
            } else if (noteNumber === 42) {
                synthesizeHiHat(now, volume);
            } else {
                synthesizeHiHat(now, volume * 0.5);
            }
        } else {
            // Melodic Parts: Bass (low) or Cowbell (high)
            const octave = parseInt(noteName.slice(-1));
            if (isNaN(octave) || octave <= 3) {
                playPhonkBass(noteName, now, volume);
            } else {
                playPhonkCowbell(noteName, now, volume);
            }
        }
    }

    function stopPhonkNote(noteName, channel) {
        const key = `${channel}-${noteName}`;
        const nodes = activePhonkNodes[key];
        if (nodes) {
            nodes.forEach(node => {
                try {
                    node.gain.gain.cancelScheduledValues(audioCtx.currentTime);
                    node.gain.gain.setValueAtTime(node.gain.gain.value, audioCtx.currentTime);
                    node.gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
                    node.osc.stop(audioCtx.currentTime + 0.08);
                } catch(e) {}
            });
            delete activePhonkNodes[key];
        }
    }

    function synthesizeKick(time, volume) {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.25);
        
        gainNode.gain.setValueAtTime(volume * 1.6, time);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
        
        osc.start(time);
        osc.stop(time + 0.26);
    }

    function synthesizeSnare(time, volume) {
        const bufferSize = audioCtx.sampleRate * 0.15;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1000;
        
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.8, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
        
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);
        
        const snapOsc = audioCtx.createOscillator();
        const snapGain = audioCtx.createGain();
        snapOsc.type = 'triangle';
        snapOsc.frequency.setValueAtTime(180, time);
        
        snapGain.gain.setValueAtTime(volume * 0.5, time);
        snapGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
        
        snapOsc.connect(snapGain);
        snapGain.connect(audioCtx.destination);
        
        noise.start(time);
        snapOsc.start(time);
        
        noise.stop(time + 0.16);
        snapOsc.stop(time + 0.09);
    }

    function synthesizeHiHat(time, volume) {
        const bufferSize = audioCtx.sampleRate * 0.04;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 7500;
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(volume * 0.4, time);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        noise.start(time);
        noise.stop(time + 0.05);
    }

    function playPhonkBass(noteName, time, volume) {
        const freq = noteNameToFreq(noteName);
        if (!freq) return;
        
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();
        
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(freq, time);
        
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(freq - 1.5, time);
        
        filter.type = 'lowpass';
        filter.frequency.value = 350;
        
        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 1.3, time + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 1.8);
        
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc1.start(time);
        osc2.start(time);
        
        osc1.stop(time + 1.9);
        osc2.stop(time + 1.9);
        
        const key = `10-${noteName}`;
        if (!activePhonkNodes[key]) activePhonkNodes[key] = [];
        activePhonkNodes[key].push({ osc: osc1, gain: gainNode }, { osc: osc2, gain: gainNode });
    }

    function playPhonkCowbell(noteName, time, volume) {
        const freq = noteNameToFreq(noteName);
        if (!freq) return;
        
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();
        
        osc1.type = 'square';
        osc1.frequency.setValueAtTime(freq, time);
        
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(freq * 1.48, time);
        
        filter.type = 'bandpass';
        filter.frequency.value = freq * 1.25;
        filter.Q.value = 4.5;
        
        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 1.2, time + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);
        
        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc1.start(time);
        osc2.start(time);
        
        osc1.stop(time + 0.5);
        osc2.stop(time + 0.5);
        
        const key = `1-${noteName}`;
        if (!activePhonkNodes[key]) activePhonkNodes[key] = [];
        activePhonkNodes[key].push({ osc: osc1, gain: gainNode }, { osc: osc2, gain: gainNode });
    }

    function noteNameToFreq(note) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const match = note.match(/^([A-G]#?)(\d+)$/);
        if (!match) return null;
        const name = match[1];
        const octave = parseInt(match[2], 10);
        const keyNumber = notes.indexOf(name) + (octave - 4) * 12;
        return 440 * Math.pow(2, keyNumber / 12);
    }

    // --- Initial Bootstrapping ---
    fetchModels();
    fetchSongs();
});
