import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  File, 
  Download, 
  Server, 
  HardDrive, 
  CloudOff, 
  CloudUpload,
  Trash2,
  FileText,
  Code
} from 'lucide-react';

class MockDistributedFileSystem {
  constructor() {
    this.files = [];
    this.nodes = [
      { id: 'node1', capacity: 10000, used: 0, status: 'active' },
      { id: 'node2', capacity: 15000, used: 0, status: 'active' },
      { id: 'node3', capacity: 20000, used: 0, status: 'active' },
      { id: 'node4', capacity: 12000, used: 0, status: 'active' },
      { id: 'node5', capacity: 18000, used: 0, status: 'active' },
      { id: 'node6', capacity: 25000, used: 0, status: 'active' }
    ];
    // Reset used values to ensure a clean slate
    this.nodes.forEach(node => (node.used = 0));
  }

  getNodeStatus() {
    let updatedNodes = this.nodes.map(node => ({
      ...node,
      status: Math.random() > 0.15 ? 'active' : 'failed' // 30% failure rate
    }));
    const hasActiveNode = updatedNodes.some(node => node.status === 'active');
    if (!hasActiveNode) {
      const randomIndex = Math.floor(Math.random() * updatedNodes.length);
      updatedNodes[randomIndex].status = 'active';
    }
    this.nodes = updatedNodes;
    console.log('Node statuses:', updatedNodes.map(node => ({ id: node.id, status: node.status })));
    return this.nodes;
  }

  recoverFiles() {
    this.files.forEach(file => {
      const activeNodes = file.nodes.filter(nodeId => {
        const node = this.nodes.find(n => n.id === nodeId);
        return node && node.status === 'active';
      });
      const neededReplicas = 4 - activeNodes.length;
      if (neededReplicas > 0) {
        const newNodes = this._selectNodes(file.size).filter(nodeId => !file.nodes.includes(nodeId));
        const additionalNodes = newNodes.slice(0, neededReplicas);
        additionalNodes.forEach(nodeId => {
          const node = this.nodes.find(n => n.id === nodeId);
          if (node) {
            node.used += (file.size / (1024 * 1024)) / 4; // Convert bytes to MB
          }
        });
        file.nodes = [...activeNodes, ...additionalNodes];
      }
    });
  }

  _selectNodes(fileSize) {
    console.log(`Selecting nodes for file of size ${fileSize} bytes`);
    const availableNodes = this.nodes
      .filter(node => node.status === 'active')
      .sort((a, b) => (b.capacity - b.used) - (a.capacity - a.used));
    
    console.log('Available nodes:', availableNodes.map(node => ({
      id: node.id,
      status: node.status,
      remainingCapacity: node.capacity - node.used
    })));

    let selectedNodes = availableNodes
      .filter(node => (node.capacity - node.used) >= (fileSize / (1024 * 1024)) / 4) // Convert bytes to MB
      .slice(0, 4)
      .map(node => node.id);

    if (selectedNodes.length === 0) {
      console.warn('No nodes with sufficient capacity. Selecting top active nodes as fallback.');
      selectedNodes = availableNodes.slice(0, 4).map(node => node.id);
    }

    if (selectedNodes.length === 0) {
      throw new Error('No active nodes available to store the file');
    }

    console.log('Selected nodes:', selectedNodes);
    return selectedNodes;
  }

  uploadFile(file, userId) {
    const fileId = `file_${Date.now()}`;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const arrayBuffer = event.target.result;
          const selectedNodes = this._selectNodes(file.size);
          if (selectedNodes.length === 0) {
            throw new Error('Failed to assign nodes to store the file');
          }
          selectedNodes.forEach(nodeId => {
            const node = this.nodes.find(n => n.id === nodeId);
            if (node) {
              node.used += (file.size / (1024 * 1024)) / selectedNodes.length; // Convert bytes to MB
            }
          });
          const fileEntry = {
            id: fileId,
            name: file.name,
            size: file.size,
            userId,
            uploadedAt: new Date(),
            nodes: selectedNodes,
            content: arrayBuffer
          };
          this.files.push(fileEntry);
          resolve(fileEntry);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => {
        reject(new Error('Failed to read the file'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  downloadFile(fileId) {
    const file = this.files.find(f => f.id === fileId);
    if (!file) {
      throw new Error('File not found');
    }
    const activeNodes = file.nodes.filter(nodeId => {
      const node = this.nodes.find(n => n.id === nodeId);
      return node && node.status === 'active';
    });
    if (activeNodes.length === 0) {
      throw new Error('Cannot download: All nodes storing this file are down');
    }
    return file;
  }

  deleteFile(fileId) {
    const fileIndex = this.files.findIndex(f => f.id === fileId);
    if (fileIndex !== -1) {
      const file = this.files[fileIndex];
      file.nodes.forEach(nodeId => {
        const node = this.nodes.find(n => n.id === nodeId);
        if (node) {
          node.used -= (file.size / (1024 * 1024)) / file.nodes.length; // Convert bytes to MB
          if (node.used < 0) node.used = 0;
        }
      });
      this.files.splice(fileIndex, 1);
    }
  }
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const DistributedFileSystemApp = () => {
  const [dfs] = useState(new MockDistributedFileSystem());
  const [files, setFiles] = useState([]);
  const [nodes, setNodes] = useState(dfs.nodes);
  const [selectedFile, setSelectedFile] = useState(null);
  const [userId, setUserId] = useState('user_' + Math.random().toString(36).substr(2, 9));
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const updateNodeStatus = () => {
      const updatedNodes = dfs.getNodeStatus();
      dfs.recoverFiles();
      setNodes([...updatedNodes]);
    };
    
    updateNodeStatus();
    const intervalId = setInterval(updateNodeStatus, 5000);
    return () => clearInterval(intervalId);
  }, [dfs]);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        setError(null);
        const uploadedFile = await dfs.uploadFile(file, userId);
        setFiles(prev => [...prev, uploadedFile]);
        setSelectedFile(uploadedFile);
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const handleFileSelect = (fileId) => {
    try {
      setError(null);
      const file = files.find(f => f.id === fileId);
      if (file) {
        setSelectedFile(file);
      } else {
        setError('File not found');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const getMimeType = (fileName) => {
    const extension = fileName.split('.').pop().toLowerCase();
    const mimeTypes = {
      'txt': 'text/plain',
      'xml': 'application/xml',
      'sccd': 'application/octet-stream',
      'exe': 'application/octet-stream',
      'pdf': 'application/pdf',
      'zip': 'application/zip',
      'jpg': 'image/jpeg',
      'png': 'image/png',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    return mimeTypes[extension] || 'application/octet-stream';
  };

  const handleDownloadClick = () => {
    if (!selectedFile) {
      setError('No file selected for download');
      return;
    }

    try {
      setError(null);
      console.log('Attempting to download:', selectedFile.name);
      console.log('Nodes storing the file:', selectedFile.nodes);
      console.log('Current node statuses:');
      selectedFile.nodes.forEach(nodeId => {
        const node = nodes.find(n => n.id === nodeId);
        console.log(`Node ${nodeId}: ${node ? node.status : 'not found'}`);
      });

      const activeNodes = selectedFile.nodes.filter(nodeId => {
        const node = nodes.find(n => n.id === nodeId);
        return node && node.status === 'active';
      });

      if (activeNodes.length === 0) {
        throw new Error('Cannot download: All nodes storing this file are down');
      }

      if (!selectedFile.content) {
        throw new Error('File content is not available for download');
      }

      const mimeType = getMimeType(selectedFile.name);
      const blob = new Blob([selectedFile.content], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = selectedFile.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteFile = (fileId) => {
    dfs.deleteFile(fileId);
    setFiles([...dfs.files]);
    if (selectedFile && selectedFile.id === fileId) {
      setSelectedFile(null);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      try {
        setError(null);
        const uploadedFile = await dfs.uploadFile(file, userId);
        setFiles(prev => [...prev, uploadedFile]);
        setSelectedFile(uploadedFile);
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const getFileIcon = (fileName) => {
    const extension = fileName.split('.').pop().toLowerCase();
    if (['java', 'js', 'py', 'cpp'].includes(extension)) {
      return <Code size={24} className="text-blue-600" />;
    }
    return <FileText size={24} className="text-gray-600" />;
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', padding: '30px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: selectedFile ? '80px' : '20px' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '700', marginBottom: '30px', display: 'flex', alignItems: 'center', color: '#1f2937' }}>
          <CloudUpload style={{ marginRight: '12px', color: '#3b82f6' }} /> Distributed File System
        </h1>
        <div style={{ background: 'linear-gradient(90deg, #dbeafe 0%, #bfdbfe 100%)', padding: '12px 20px', borderRadius: '8px', marginBottom: '30px', display: 'flex', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <Server style={{ marginRight: '12px', color: '#3b82f6' }} />
          <span style={{ fontWeight: '600', color: '#1e40af' }}>User ID: {userId}</span>
        </div>
        {error && (
          <div style={{ backgroundColor: '#f87171', color: 'white', padding: '12px 20px', borderRadius: '8px', marginBottom: '30px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            {error}
          </div>
        )}
        <div style={{ backgroundColor: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderRadius: '12px', padding: '30px', marginBottom: '30px' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: '600', marginBottom: '20px', display: 'flex', alignItems: 'center', color: '#1f2937' }}>
            <Upload style={{ marginRight: '12px', color: '#3b82f6' }} /> Upload File
          </h2>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? '#3b82f6' : '#d1d5db'}`,
              borderRadius: '12px',
              padding: '50px',
              textAlign: 'center',
              background: isDragging ? 'linear-gradient(135deg, #e0f2fe 0%, #bfdbfe 100%)' : '#f9fafb',
              transition: 'all 0.3s ease',
              boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <CloudUpload size={48} style={{ color: '#3b82f6', marginBottom: '15px' }} />
            <p style={{ fontSize: '1.25rem', fontWeight: '500', color: '#4b5563', marginBottom: '10px' }}>
              Drag and drop your file here
            </p>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', marginBottom: '20px' }}>
              or
            </p>
            <button
              onClick={() => fileInputRef.current.click()}
              style={{
                background: 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: '600',
                transition: 'all 0.3s ease',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
              onMouseOver={(e) => (e.target.style.background = 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)')}
              onMouseOut={(e) => (e.target.style.background = 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)')}
            >
              Browse Files
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>
        </div>
        <div style={{ backgroundColor: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderRadius: '12px', padding: '30px', marginBottom: '30px' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: '600', marginBottom: '20px', display: 'flex', alignItems: 'center', color: '#1f2937' }}>
            <HardDrive style={{ marginRight: '12px', color: '#3b82f6' }} /> Storage Nodes
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
            {nodes.map((node, index) => (
              <div 
                key={node.id} 
                style={{
                  padding: '20px',
                  borderRadius: '10px',
                  border: 'none',
                  background: node.status === 'active' 
                    ? 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)' 
                    : 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  transition: 'transform 0.2s ease',
                }}
                onMouseOver={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                onMouseOut={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1f2937' }}>Node {index + 1}</span>
                  {node.status === 'active' ? (
                    <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#10b981' }}>Active</span>
                  ) : (
                    <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#ef4444' }}>Failed</span>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '0.9rem', color: '#6b7280' }}>Capacity: {node.capacity} MB</div>
                  <div style={{ fontSize: '0.9rem', color: '#6b7280' }}>Used: {Math.round(node.used * 100) / 100} MB</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ backgroundColor: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderRadius: '12px', padding: '30px' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: '600', marginBottom: '20px', display: 'flex', alignItems: 'center', color: '#1f2937' }}>
            <File style={{ marginRight: '12px', color: '#3b82f6' }} /> Uploaded Files
          </h2>
          {files.length === 0 ? (
            <div style={{ color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '50px', background: '#f9fafb', borderRadius: '10px' }}>
              <CloudOff style={{ marginRight: '12px', color: '#9ca3af' }} /> No files uploaded yet
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {files.map((file) => (
                <div
                  key={file.id}
                  style={{
                    border: 'none',
                    borderRadius: '10px',
                    padding: '20px',
                    background: 'linear-gradient(135deg, #ffffff 0%, #f9fafb 100%)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                    cursor: 'pointer'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.1)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                    {getFileIcon(file.name)}
                    <div style={{ marginLeft: '12px', flex: 1, minWidth: 0 }}>
                      <div 
                        style={{ 
                          fontWeight: '600', 
                          fontSize: '1rem', 
                          color: '#1f2937', 
                          whiteSpace: 'nowrap', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis' 
                        }}
                        title={file.name}
                      >
                        {file.name}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {formatFileSize(file.size)} | Uploaded: {new Date(file.uploadedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                    <button
                      onClick={() => handleFileSelect(file.id)}
                      style={{
                        flex: 1,
                        background: selectedFile && selectedFile.id === file.id 
                          ? 'linear-gradient(90deg, #1e40af 0%, #1e3a8a 100%)' 
                          : 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)',
                        color: 'white',
                        padding: '10px',
                        borderRadius: '8px',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        transition: 'all 0.3s ease',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                      }}
                      onMouseOver={(e) => {
                        if (!selectedFile || selectedFile.id !== file.id) {
                          e.target.style.background = 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)';
                        }
                      }}
                      onMouseOut={(e) => {
                        if (!selectedFile || selectedFile.id !== file.id) {
                          e.target.style.background = 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)';
                        }
                      }}
                    >
                      <Download size={16} style={{ marginRight: '6px' }} /> Select
                    </button>
                    <button
                      onClick={() => handleDeleteFile(file.id)}
                      style={{
                        flex: 1,
                        background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                        color: 'white',
                        padding: '10px',
                        borderRadius: '8px',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        transition: 'all 0.3s ease',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                      }}
                      onMouseOver={(e) => (e.target.style.background = 'linear-gradient(90deg, #dc2626 0%, #b91c1c 100%)')}
                      onMouseOut={(e) => (e.target.style.background = 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)')}
                    >
                      <Trash2 size={16} style={{ marginRight: '6px' }} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {selectedFile && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'linear-gradient(90deg, #dbeafe 0%, #bfdbfe 100%)', padding: '15px', boxShadow: '0 -4px 12px rgba(0,0,0,0.1)', zIndex: 10 }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div 
                style={{ 
                  fontWeight: '600', 
                  fontSize: '1rem', 
                  color: '#1e40af', 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis' 
                }}
                title={`Selected File: ${selectedFile.name}`}
              >
                Selected File: {selectedFile.name}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#4b5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Stored on nodes: {selectedFile.nodes.join(', ')}
              </div>
            </div>
            <button 
              style={{ 
                background: 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)', 
                color: 'white', 
                padding: '10px 24px', 
                borderRadius: '8px', 
                display: 'flex', 
                alignItems: 'center', 
                fontWeight: '600',
                transition: 'all 0.3s ease',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
              onClick={handleDownloadClick}
              onMouseOver={(e) => (e.target.style.background = 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)')}
              onMouseOut={(e) => (e.target.style.background = 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)')}
            >
              <Download style={{ marginRight: '8px' }} /> Download
            </button>
          </div>
        </div>
      )}
    </div>
  ); 
};

export default DistributedFileSystemApp;