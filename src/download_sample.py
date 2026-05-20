import os
import urllib.request

def download_midi_samples():
    """ Downloads a few sample MIDI files for testing. """
    
    # Ensure data/midi directory exists
    os.makedirs('data/midi', exist_ok=True)
    
    # A few public domain / open source MIDI file URLs (Bach, Beethoven, Chopin)
    # Hosted on various public github repositories or archives.
    urls = [
        "https://raw.githubusercontent.com/bspaans/python-mingus/master/tests/midi/test.mid",
        # Adding a few generic reliable midi files
    ]
    
    # Let's use a reliable github repo for piano midi files (MAESTRO sample or similar)
    # We will use the python-mingus test midi for a quick test, but real training needs more data.
    # We will download some Chopin files from a known public repository
    
    chopin_urls = [
        "https://bitmidi.com/uploads/15174.mid", # Chopin Nocturne op. 9 no. 2
        "https://bitmidi.com/uploads/15160.mid"  # Chopin Etude
    ]
    
    for i, url in enumerate(chopin_urls):
        filename = f"data/midi/sample_{i+1}.mid"
        if not os.path.exists(filename):
            print(f"Downloading {url} to {filename}...")
            try:
                # Add headers to avoid 403 Forbidden
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req) as response, open(filename, 'wb') as out_file:
                    out_file.write(response.read())
                print(f"Downloaded {filename} successfully.")
            except Exception as e:
                print(f"Failed to download {url}: {e}")
        else:
            print(f"{filename} already exists.")

if __name__ == '__main__':
    download_midi_samples()
    print("\nNote: For better training results, please download a larger dataset like the MAESTRO dataset")
    print("or put your own .mid files into the data/midi/ directory.")
