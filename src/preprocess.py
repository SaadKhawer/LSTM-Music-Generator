import glob
import pickle
import numpy as np
from music21 import converter, instrument, note, chord
import os
from tensorflow.keras.utils import to_categorical

def get_notes(data_dir):
    """ Get all the notes and chords from the midi files in the data directory """
    notes = []
    
    files = glob.glob(os.path.join(data_dir, "*.mid"))
    if len(files) == 0:
        raise ValueError(f"No MIDI files found in {data_dir}. Please add some .mid files.")

    print(f"Found {len(files)} MIDI files. Processing...")
    
    for file in files:
        try:
            midi = converter.parse(file)
            print(f"Parsing {file}")
            notes_to_parse = midi.flatten().notes

            for element in notes_to_parse:
                if isinstance(element, note.Note):
                    notes.append(str(element.pitch))
                elif isinstance(element, chord.Chord):
                    notes.append('.'.join(str(n) for n in element.normalOrder))
        except Exception as e:
            print(f"Error parsing {file}: {e}")

    with open('data/notes.pkl', 'wb') as filepath:
        pickle.dump(notes, filepath)

    return notes

def prepare_sequences(notes, n_vocab, sequence_length=100):
    """ Prepare the sequences used by the Neural Network """
    
    if len(notes) == 0:
        raise ValueError("No notes were found in the MIDI files. Please ensure the MIDI files contain valid note data.")
        
    # get all pitch names
    pitches = sorted(set(item for item in notes))
    
    # create a dictionary to map pitches to integers
    note_to_int = dict((note, number) for number, note in enumerate(pitches))

    network_input = []
    network_output = []

    # Ensure sequence_length is smaller than the total notes available
    if len(notes) <= sequence_length:
        sequence_length = max(1, len(notes) - 1)
        print(f"Warning: Not enough notes. Reduced sequence_length to {sequence_length}")

    # create input sequences and the corresponding outputs
    for i in range(0, len(notes) - sequence_length, 1):
        sequence_in = notes[i:i + sequence_length]
        sequence_out = notes[i + sequence_length]
        network_input.append([note_to_int[char] for char in sequence_in])
        network_output.append(note_to_int[sequence_out])

    n_patterns = len(network_input)

    # reshape the input into a format compatible with LSTM layers
    network_input = np.reshape(network_input, (n_patterns, sequence_length, 1))
    
    # normalize input
    network_input = network_input / float(n_vocab)

    network_output = to_categorical(network_output)

    return network_input, network_output, note_to_int

if __name__ == "__main__":
    if not os.path.exists('data'):
        os.makedirs('data')
    if not os.path.exists('data/midi'):
        os.makedirs('data/midi')
        print("Created data/midi folder. Please place .mid files there and run again.")
    else:
        notes = get_notes('data/midi')
        n_vocab = len(set(notes))
        network_input, network_output, _ = prepare_sequences(notes, n_vocab)
        print("Data preprocessing complete.")
        print(f"Total notes processed: {len(notes)}")
        print(f"Unique notes (vocabulary size): {n_vocab}")
        print(f"Network input shape: {network_input.shape}")
        
        # Save preprocessed data
        with open('data/network_input.pkl', 'wb') as f:
            pickle.dump(network_input, f)
        with open('data/network_output.pkl', 'wb') as f:
            pickle.dump(network_output, f)
