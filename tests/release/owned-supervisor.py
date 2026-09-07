#!/usr/bin/env python3
"""Linux subreaper: detached descendants remain owned after their parent exits."""
import ctypes
import json
import os
import signal
import subprocess
import sys
import time

if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    sys.stderr.write("Cannot establish owned descendant subreaper\n")
    sys.exit(70)

stopping = False
received_signal = None

def request_stop(signum, _frame):
    global stopping, received_signal
    stopping = True
    received_signal = signum

signal.signal(signal.SIGTERM, request_stop)
signal.signal(signal.SIGINT, request_stop)

def identity(pid):
    try:
        with open(f"/proc/{pid}/stat") as stream:
            raw = stream.read()
        fields = raw[raw.rfind(") ") + 2:].split()
        return fields[19], fields[0]
    except (FileNotFoundError, ProcessLookupError):
        return None

def descendants():
    queue = [os.getpid()]
    found = {}
    while queue:
        parent = queue.pop()
        try:
            with open(f"/proc/{parent}/task/{parent}/children") as stream:
                children = [int(value) for value in stream.read().split()]
        except (FileNotFoundError, ProcessLookupError):
            continue
        for pid in children:
            if pid in found:
                continue
            record = identity(pid)
            if record:
                found[pid] = record
                queue.append(pid)
    return found

def terminate(signum):
    for pid, record in reversed(list(descendants().items())):
        if identity(pid) == record and record[1] not in ("Z", "X"):
            try:
                os.kill(pid, signum)
            except ProcessLookupError:
                pass

try:
    child = subprocess.Popen(sys.argv[1:])
except Exception as error:
    sys.stderr.write(f"Owned command spawn failed: {error}\n")
    sys.exit(70)

status = None
while status is None and not stopping:
    waited, result = os.waitpid(child.pid, os.WNOHANG)
    if waited:
        status = os.waitstatus_to_exitcode(result)
        child.returncode = status
    else:
        time.sleep(0.01)

# Reap only our children; never signal or reap unrelated processes.
def reap():
    global status
    while True:
        try:
            pid, result = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if not pid:
            return
        if pid == child.pid:
            status = os.waitstatus_to_exitcode(result)
            child.returncode = status

reap()
leftovers = [pid for pid, record in descendants().items() if record[1] not in ("Z", "X")]
if leftovers and not stopping:
    sys.stderr.write("Owned leftover identities: " + json.dumps({pid: identity(pid) for pid in leftovers}) + "\n")
if leftovers or stopping:
    terminate(signal.SIGTERM)
    deadline = time.monotonic() + 0.5
    while descendants() and time.monotonic() < deadline:
        reap()
        time.sleep(0.01)
    terminate(signal.SIGKILL)
    deadline = time.monotonic() + 0.25
    while descendants() and time.monotonic() < deadline:
        reap()
        time.sleep(0.01)
reap()
if descendants():
    sys.stderr.write("Owned descendants survived teardown\n")
    sys.exit(70)
if received_signal:
    sys.exit(128 + received_signal)
if leftovers:
    sys.stderr.write("Owned runner left descendants after exit; terminated and reaped them\n")
    sys.exit(70)
sys.exit(status if status is not None and status >= 0 else 128 - (status or -1))
