import os
import json
import glob
import datetime
import subprocess
from flask import Flask, render_template, request, jsonify, send_file

app = Flask(__name__)

METADATA_FILE = 'output/metadata.json'

def load_metadata():
    if os.path.exists(METADATA_FILE):
        try:
            with open(METADATA_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_metadata(metadata):
    os.makedirs('output', exist_ok=True)
    try:
        with open(METADATA_FILE, 'w') as f:
            json.dump(metadata, f, indent=4)
    except Exception as e:
        print(f"Error saving metadata: {e}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/models', methods=['GET'])
def get_models():
    try:
        models = []
        if os.path.exists('models'):
            # Find all .keras files
            for file in glob.glob('models/*.keras'):
                name = os.path.basename(file)
                models.append(name)
        # Sort models, final_model.keras first, then checkpoints descending
        models.sort(key=lambda x: (x != 'final_model.keras', x), reverse=False)
        return jsonify({"status": "success", "models": models})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/songs', methods=['GET'])
def get_songs():
    try:
        # Load custom metadata
        metadata = load_metadata()
        
        songs = []
        # Add demo songs
        demo_dir = 'data/midi'
        if os.path.exists(demo_dir):
            for file in glob.glob(os.path.join(demo_dir, '*.mid')):
                filename = os.path.basename(file)
                # Pretty names for demos
                name = "Chopin Nocturne Op.9 No.2" if "sample_1" in filename else ("Chopin Etude Op.10 No.3" if "sample_2" in filename else filename)
                songs.append({
                    "id": filename,
                    "filename": filename,
                    "title": name,
                    "artist": "Frédéric Chopin",
                    "type": "demo",
                    "file": f"/download/{filename}",
                    "date": "Original Classical",
                    "model": "N/A",
                    "genre": "piano"
                })
        
        # Add generated songs
        output_dir = 'output'
        if os.path.exists(output_dir):
            for file in glob.glob(os.path.join(output_dir, '*.mid')):
                filename = os.path.basename(file)
                # Ignore metadata.json
                if filename == 'metadata.json':
                    continue
                meta = metadata.get(filename, {})
                title = meta.get("title", f"AI Symphony ({filename})")
                model_used = meta.get("model", "Unknown Model")
                timestamp = meta.get("timestamp", datetime.datetime.fromtimestamp(os.path.getmtime(file)).strftime("%Y-%m-%d %H:%M"))
                genre_type = meta.get("genre", "piano")
                
                songs.append({
                    "id": filename,
                    "filename": filename,
                    "title": title,
                    "artist": "Symphony AI Engine",
                    "type": "generated",
                    "file": f"/download/{filename}",
                    "date": timestamp,
                    "model": model_used,
                    "genre": genre_type
                })
        
        # Sort generated songs by date/time (newest first), keeping demos at the top or bottom
        generated_songs = [s for s in songs if s["type"] == "generated"]
        demo_songs = [s for s in songs if s["type"] == "demo"]
        
        generated_songs.sort(key=lambda x: x["date"], reverse=True)
        
        return jsonify({"status": "success", "songs": demo_songs + generated_songs})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/songs/<filename>', methods=['DELETE'])
def delete_song(filename):
    try:
        # Secure check to prevent path traversal
        if '/' in filename or '\\' in filename or filename == 'metadata.json':
            return jsonify({"status": "error", "message": "Invalid filename"}), 400
            
        file_path = os.path.join('output', filename)
        if os.path.exists(file_path):
            os.remove(file_path)
            
            # Remove from metadata
            metadata = load_metadata()
            if filename in metadata:
                del metadata[filename]
                save_metadata(metadata)
                
            return jsonify({"status": "success", "message": f"Successfully deleted '{filename}'."})
        return jsonify({"status": "error", "message": "File not found."}), 404
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/generate', methods=['POST'])
def generate():
    try:
        data = request.json or {}
        model_name = data.get('model_weights', 'final_model.keras')
        song_title = data.get('song_title', '').strip()
        genre = data.get('genre', 'piano')
        
        # If Phonk genre is requested, it's generated programmatically
        if genre == 'phonk':
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"phonk_{timestamp}.mid"
            dest_path = os.path.join('output', filename)
            
            # Run generator script with --genre phonk
            subprocess.run(['python', '-m', 'src.generate', 'models/final_model.keras', dest_path, '--genre', 'phonk'], check=True)
            
            # Save metadata
            metadata = load_metadata()
            display_title = song_title if song_title else f"AI Phonk Masterpiece #{len(metadata)+1}"
            metadata[filename] = {
                "title": display_title,
                "model": "Procedural Phonk Synth",
                "genre": "phonk",
                "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
            }
            save_metadata(metadata)
            
            return jsonify({
                "status": "success", 
                "message": f"Phonk track '{display_title}' composed instantly!",
                "file": f"/download/{filename}",
                "title": display_title
            })
            
        # Validate model path for standard piano generation
        model_weights_path = os.path.join('models', model_name)
        if not os.path.exists(model_weights_path):
            # Try finding alternative checkpoint
            import glob
            checkpoints = glob.glob('models/weights-improvement-*.keras')
            if checkpoints:
                checkpoints.sort()
                model_weights_path = checkpoints[-1]
                model_name = os.path.basename(model_weights_path)
            else:
                # Demo mode fallback if no models exist at all
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"composition_{timestamp}.mid"
                demo_source = 'data/midi/sample_1.mid'
                os.makedirs('output', exist_ok=True)
                
                if os.path.exists(demo_source):
                    import shutil
                    dest_path = os.path.join('output', filename)
                    shutil.copy(demo_source, dest_path)
                    
                    # Save metadata
                    metadata = load_metadata()
                    display_title = song_title if song_title else f"AI Symphony #{len(metadata)+1}"
                    metadata[filename] = {
                        "title": display_title,
                        "model": "Demo Fallback (No Model)",
                        "genre": "piano",
                        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
                    }
                    save_metadata(metadata)
                    
                    return jsonify({
                        "status": "success", 
                        "message": "Demo mode: Music generated (using sample due to missing trained model)!",
                        "file": f"/download/{filename}",
                        "title": display_title
                    })
                else:
                    return jsonify({
                        "status": "error", 
                        "message": "Model not found and no demo samples available."
                    }), 400
        
        # Generate unique filename using timestamp
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"composition_{timestamp}.mid"
        dest_path = os.path.join('output', filename)
        
        # Run generation script with weight path and custom output path
        subprocess.run(['python', '-m', 'src.generate', model_weights_path, dest_path, '--genre', 'piano'], check=True)
        
        # Add metadata
        metadata = load_metadata()
        display_title = song_title if song_title else f"AI Symphony #{len(metadata)+1}"
        metadata[filename] = {
            "title": display_title,
            "model": model_name,
            "genre": "piano",
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        }
        save_metadata(metadata)
        
        msg = f"Music '{display_title}' generated successfully!"
        return jsonify({
            "status": "success", 
            "message": msg,
            "file": f"/download/{filename}",
            "title": display_title
        })
    except subprocess.CalledProcessError as e:
        return jsonify({"status": "error", "message": "Failed to generate music. Check server logs."}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/train', methods=['POST'])
def train():
    try:
        if not os.path.exists('data/network_input.pkl'):
            subprocess.run(['python', '-m', 'src.preprocess'], check=True)
        return jsonify({
            "status": "success", 
            "message": "Data preprocessed successfully! For actual training, please run 'python -m src.train' in your terminal as it takes several hours."
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/download/<filename>')
def download(filename):
    # secure check
    if '/' in filename or '\\' in filename:
        return jsonify({"error": "Invalid filename"}), 400
        
    # Check output folder first
    file_path = os.path.join('output', filename)
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True)
        
    # Check data/midi folder
    file_path = os.path.join('data/midi', filename)
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True)
        
    return jsonify({"error": "File not found."}), 404

if __name__ == '__main__':
    app.run(debug=False, port=5001)
