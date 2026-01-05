package com.atomjiujitsu.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Gestion personnalisée du bouton Back Android
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        // Si la WebView peut revenir en arrière (page interne) -> goBack
        if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
          bridge.getWebView().goBack();
        } else {
          // Sinon (page d'accueil / plus d'historique) -> demander confirmation avant de quitter
          new AlertDialog.Builder(MainActivity.this)
            .setMessage("Voulez-vous quitter l’application ATOM ?")
            .setPositiveButton("Oui", (dialog, which) -> {
              dialog.dismiss();
              finish(); // ferme l'activité = quitte l'app
            })
            .setNegativeButton("Non", (dialog, which) -> dialog.dismiss())
            .show();
        }
      }
    });
  }
}
