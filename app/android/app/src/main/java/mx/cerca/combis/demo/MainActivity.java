package mx.cerca.combis.demo;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(VoiceSearchPlugin.class);
        super.onCreate(state);
    }
}
