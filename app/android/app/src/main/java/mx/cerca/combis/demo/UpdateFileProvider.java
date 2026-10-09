package mx.cerca.combis.demo;
import androidx.core.content.FileProvider;
/** Separate provider exposes only verified update files, never the rest of app storage. */
public class UpdateFileProvider extends FileProvider {}
