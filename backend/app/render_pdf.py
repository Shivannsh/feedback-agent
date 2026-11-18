"""Render in a separate process so PDF decoding cannot block the API worker."""

import json
import sys
from pathlib import Path

import pypdfium2 as pdfium


def render(source: Path, destination: Path):
    document = pdfium.PdfDocument(source)
    try:
        if not 1 <= len(document) <= 20:
            raise ValueError("Choose a PDF with between 1 and 20 slides.")
        pages = []
        for index in range(len(document)):
            page = document[index]
            try:
                width, height = page.get_size()
                if min(width, height) <= 0:
                    raise ValueError("A slide has invalid dimensions.")
                bitmap = page.render(scale=1440 / max(width, height))
                try:
                    image = bitmap.to_pil().convert("RGB")
                    image.save(destination / f"{index + 1}.jpg", quality=90)
                    pages.append(
                        {
                            "number": index + 1,
                            "width": image.width,
                            "height": image.height,
                        }
                    )
                finally:
                    bitmap.close()
            finally:
                page.close()
        (destination / "pages.json").write_text(json.dumps(pages))
    finally:
        document.close()


if __name__ == "__main__":
    render(Path(sys.argv[1]), Path(sys.argv[2]))
