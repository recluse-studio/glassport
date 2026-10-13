#!/usr/bin/env python3
"""Run the pinned Apple-device client with private state retained in Glassport."""
from pathlib import Path
import os,runpy,tempfile
import pymobiledevice3.common as common
root=Path(__file__).resolve().parents[1]
os.umask(0o077)
common._HOMEFOLDER=root/'runtime/apple-device'
common._HOMEFOLDER.mkdir(parents=True,exist_ok=True,mode=0o700)
common._HOMEFOLDER.chmod(0o700)
workspace_tmp=root/'runtime/ios-tmp'
workspace_tmp.mkdir(parents=True,exist_ok=True,mode=0o700)
tempfile.tempdir=str(workspace_tmp)
runpy.run_module('pymobiledevice3',run_name='__main__')
