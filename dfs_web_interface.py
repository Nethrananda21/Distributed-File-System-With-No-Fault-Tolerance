import asyncio
import random
import hashlib
from collections import defaultdict
from flask import Flask, request, render_template, send_file
from io import BytesIO
import threading

# Node class (unchanged from previous)
class Node:
    def __init__(self, node_id, capacity=100):
        self.node_id = node_id
        self.capacity = capacity
        self.storage = {}  # {chunk_id: data}
        self.active = True

    def store_chunk(self, chunk_id, data):
        if len(self.storage) < self.capacity and self.active:
            self.storage[chunk_id] = data
            return True
        return False

    def retrieve_chunk(self, chunk_id):
        return self.storage.get(chunk_id) if self.active else None

    def fail(self):
        self.active = False
        print(f"Node {self.node_id} has failed.")

# Distributed File System (adapted for web)
class DFS:
    def __init__(self, num_nodes=5, replication_factor=2):
        self.nodes = [Node(i) for i in range(num_nodes)]
        self.replication_factor = replication_factor
        self.metadata = defaultdict(list)  # {file_hash: [(node_id, chunk_id)]}
        self.chunk_size = 1024  # Simulated chunk size in bytes

    def upload_file(self, filename, content):
        file_hash = hashlib.sha256(filename.encode()).hexdigest()
        chunks = [content[i:i+self.chunk_size] for i in range(0, len(content), self.chunk_size)]
        
        for i, chunk in enumerate(chunks):
            chunk_id = f"{file_hash}_chunk_{i}"
            replicas_placed = 0
            for node in sorted(self.nodes, key=lambda x: len(x.storage)):  # Load balancing
                if node.store_chunk(chunk_id, chunk):
                    self.metadata[file_hash].append((node.node_id, chunk_id))
                    replicas_placed += 1
                    if replicas_placed == self.replication_factor:
                        break
            if replicas_placed < self.replication_factor:
                print(f"Warning: Could not place all replicas for {chunk_id}")
        return file_hash

    def download_file(self, file_hash):
        if file_hash not in self.metadata:
            return None
        
        chunks = {}
        for node_id, chunk_id in self.metadata[file_hash]:
            node = self.nodes[node_id]
            chunk_data = node.retrieve_chunk(chunk_id)
            if chunk_data:
                chunks[chunk_id] = chunk_data
        
        if not chunks:
            return None
        
        sorted_chunks = sorted(chunks.items(), key=lambda x: int(x[0].split('_chunk_')[1]))
        return b''.join(chunk for _, chunk in sorted_chunks)

    async def monitor_nodes(self):
        while True:
            for node in self.nodes:
                if random.random() < 0.1:  # 10% chance of failure
                    node.fail()
                    await self.recover_data(node.node_id)
            await asyncio.sleep(5)

    async def recover_data(self, failed_node_id):
        affected_chunks = [(file_hash, chunk_id) for file_hash, chunks in self.metadata.items() 
                          for node_id, chunk_id in chunks if node_id == failed_node_id]
        for file_hash, chunk_id in affected_chunks:
            for node_id, cid in self.metadata[file_hash]:
                if cid == chunk_id and node_id != failed_node_id:
                    chunk_data = self.nodes[node_id].retrieve_chunk(chunk_id)
                    if chunk_data:
                        for new_node in self.nodes:
                            if new_node.active and new_node.node_id != node_id:
                                if new_node.store_chunk(chunk_id, chunk_data):
                                    self.metadata[file_hash].append((new_node.node_id, chunk_id))
                                    print(f"Re-replicated {chunk_id} to node {new_node.node_id}")
                                    break
            self.metadata[file_hash] = [(nid, cid) for nid, cid in self.metadata[file_hash] if nid != failed_node_id]

    def get_status(self):
        return {
            "nodes": [{"id": n.node_id, "active": n.active, "chunks": len(n.storage)} for n in self.nodes],
            "files": {file_hash: len(chunks) for file_hash, chunks in self.metadata.items()}
        }

# Flask app
app = Flask(__name__)
dfs = DFS()

# Run DFS monitoring in a separate thread
def run_monitoring():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(dfs.monitor_nodes())

threading.Thread(target=run_monitoring, daemon=True).start()

@app.route('/')
def index():
    status = dfs.get_status()
    return render_template('index.html', status=status)

@app.route('/upload', methods=['POST'])
def upload():
    file = request.files['file']
    if file:
        content = file.read()
        file_hash = dfs.upload_file(file.filename, content)
        return f"File uploaded successfully. Hash: {file_hash}"
    return "No file uploaded", 400

@app.route('/download/<file_hash>')
def download(file_hash):
    content = dfs.download_file(file_hash)
    if content:
        return send_file(BytesIO(content), download_name=f"file_{file_hash}", as_attachment=True)
    return "File not found or unavailable", 404

# HTML template (embedded as a string for simplicity)
@app.route('/template')
def get_template():
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Distributed File System</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .status { margin-top: 20px; }
        </style>
    </head>
    <body>
        <h1>Distributed File System</h1>
        <h2>Upload File</h2>
        <form action="/upload" method="post" enctype="multipart/form-data">
            <input type="file" name="file" required>
            <input type="submit" value="Upload">
        </form>
        <h2>Download File</h2>
        <form action="/download" method="get">
            <input type="text" name="file_hash" placeholder="Enter file hash" required>
            <input type="submit" value="Download">
        </form>
        <h2>System Status</h2>
        <div class="status">
            <h3>Nodes</h3>
            <ul>
                {% for node in status.nodes %}
                    <li>Node {{ node.id }}: {{ 'Active' if node.active else 'Failed' }}, Chunks: {{ node.chunks }}</li>
                {% endfor %}
            </ul>
            <h3>Files</h3>
            <ul>
                {% for file_hash, chunk_count in status.files.items %}
                    <li>File Hash: {{ file_hash }}, Chunks: {{ chunk_count }}</li>
                {% endfor %}
            </ul>
        </div>
    </body>
    </html>
    """

if __name__ == "__main__":
    app.run(debug=True)