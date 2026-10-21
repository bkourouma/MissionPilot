"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../lib/api";
import {
  API_VEILLE,
  messageVeille,
  texteBilanVeille,
  type BilanVeille,
  type SourceVeilleVue,
} from "../../lib/appels-offres-veille";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";

/**
 * Sources de veille (AO-01) : activation par cabinet (désactivées par défaut) et collecte
 * déclenchée à la main. Les sources sont SIMULÉES : aucun appel externe, aucune clé.
 */
export function VeilleSources({
  sources,
  gerer,
}: {
  sources: readonly SourceVeilleVue[];
  gerer: boolean;
}) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [bilan, setBilan] = useState<BilanVeille | null>(null);
  const actives = sources.filter((s) => s.active).length;

  async function executer(cle: string, action: () => Promise<void>) {
    setEnCours(cle);
    setErreur(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setErreur(messageVeille(e));
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="mp-pile">
      <ul className="mp-liste-lignes">
        {sources.map((s) => (
          <li key={s.code} className="mp-liste-lignes__ligne">
            <CaseACocher
              libelle={s.libelle}
              aide={s.active ? "Activée pour votre cabinet." : "Désactivée."}
              checked={s.active}
              disabled={!gerer || enCours !== null}
              onChange={(e) =>
                executer(s.code, async () => {
                  await api.put(`${API_VEILLE}/sources/${encodeURIComponent(s.code)}`, {
                    active: e.target.checked,
                  });
                })
              }
            />
          </li>
        ))}
      </ul>
      <p className="mp-texte-doux mp-texte-petit">
        Sources simulées : des avis fictifs servent à essayer la veille. Aucune adresse n&apos;est
        visitée par le serveur.
      </p>
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {bilan ? (
        <Alerte tonalite="succes">
          <p>{texteBilanVeille(bilan)}</p>
        </Alerte>
      ) : null}
      {gerer ? (
        <Bouton
          variante="primaire"
          chargement={enCours === "collecte"}
          texteChargement="Collecte…"
          disabled={actives === 0 || enCours !== null}
          onClick={() =>
            executer("collecte", async () => {
              setBilan(await api.post<BilanVeille>(`${API_VEILLE}/collecte`, {}));
            })
          }
        >
          Collecter maintenant
        </Bouton>
      ) : null}
    </div>
  );
}
