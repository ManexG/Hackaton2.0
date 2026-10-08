package mx.cerca.combis.demo;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

@CapacitorPlugin(name = "VoiceSearch")
public class VoiceSearchPlugin extends Plugin {
    private boolean listening = false;
    @PluginMethod
    public void start(PluginCall call) {
        if (listening) { call.reject("El micrófono ya está activo."); return; }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Di un negocio, lugar o calle de la zona");
        try { listening = true; startActivityForResult(call, intent, "voiceResult"); }
        catch (ActivityNotFoundException error) { listening = false; call.reject("Este teléfono no tiene reconocimiento de voz disponible. Puedes escribir tu destino."); }
    }
    @ActivityCallback
    private void voiceResult(PluginCall call, ActivityResult result) {
        listening = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("Búsqueda por voz cancelada."); return; }
        ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        JSObject response = new JSObject(); response.put("text", matches == null || matches.isEmpty() ? "" : matches.get(0)); call.resolve(response);
    }
}
