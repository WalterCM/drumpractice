# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Recolectar datos y submódulos requeridos
datas = []
datas += collect_data_files('demucs')
datas += collect_data_files('librosa')
datas += collect_data_files('torchaudio')

hiddenimports = []
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('fastapi')
hiddenimports += collect_submodules('starlette')
hiddenimports += collect_submodules('demucs')
hiddenimports += collect_submodules('librosa')
hiddenimports += collect_submodules('yt_dlp')
hiddenimports += [
    'multipart',
    'soundfile',
    'scipy.special.cython_special',
    'scipy.spatial.transform._rotation_groups',
    'torch',
    'torchaudio',
]

binaries = []
backend_dir = os.path.dirname(os.path.abspath(SPEC)) if 'SPEC' in locals() else os.getcwd()
for bin_name in ['ffmpeg.exe', 'ffprobe.exe', 'ffmpeg', 'ffprobe']:
    bin_path = os.path.join(backend_dir, bin_name)
    if os.path.exists(bin_path):
        binaries.append((bin_path, '.'))

a = Analysis(
    ['server_entry.py'],
    pathex=[backend_dir],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'IPython', 'notebook', 'pytest'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Genera un único binario ejecutable (.exe autocontenido)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='drum-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False, # En Windows corre silencioso sin ventana de consola negra
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
