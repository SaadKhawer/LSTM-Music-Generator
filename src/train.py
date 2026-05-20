import pickle
import os
from tensorflow.keras.callbacks import ModelCheckpoint
from src.model import create_network

def train_network():
    """ Train a Neural Network to generate music """
    
    # Check if preprocessed data exists
    if not os.path.exists('data/network_input.pkl') or not os.path.exists('data/network_output.pkl'):
        raise FileNotFoundError("Preprocessed data not found. Please run preprocess.py first.")
        
    with open('data/network_input.pkl', 'rb') as f:
        network_input = pickle.load(f)
    with open('data/network_output.pkl', 'rb') as f:
        network_output = pickle.load(f)
    with open('data/notes.pkl', 'rb') as f:
        notes = pickle.load(f)

    n_vocab = len(set(notes))

    model = create_network(network_input, n_vocab)

    filepath = "models/weights-improvement-{epoch:02d}-{loss:.4f}.keras"
    
    checkpoint = ModelCheckpoint(
        filepath,
        monitor='loss',
        verbose=0,
        save_best_only=True,
        mode='min'
    )
    callbacks_list = [checkpoint]

    if not os.path.exists('models'):
        os.makedirs('models')

    print("Starting training...")
    
    model.fit(
        network_input, network_output,
        epochs=100,
        batch_size=64,
        callbacks=callbacks_list
    )
    
    # Save final model
    model.save('models/final_model.keras')
    print("Training completed. Model saved to models/final_model.keras")

if __name__ == '__main__':
    train_network()
