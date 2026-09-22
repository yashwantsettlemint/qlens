class ModelUnavailable(RuntimeError):
    """Raised when a required trained model (.pkl) is missing or unloadable.
    There is no heuristic / rule-based fallback — /score and /check-duplicate
    fail loudly so a missing model can't be served silently."""
