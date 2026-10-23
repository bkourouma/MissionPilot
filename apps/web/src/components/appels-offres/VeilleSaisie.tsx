"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useState } from "react";
import { veilleAvisSaisieSchema } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  API_VEILLE,
  messageVeille,
  texteBilanVeille,
  texteErreursImport,
  verifierFichierImport,
  type BilanVeille,
} from "../../lib/appels-offres-veille";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

const VIDE = {
  titre: "",
  reference: "",
  bailleur: "",
  pays: "",
  secteur: "",
  date_limite: "",
  objet: "",
};

/** Saisie manuelle d'un avis de veille : dédoublonné et rapproché par l'API. */
export function VeilleSaisieAvis() {
  const { rafraichir } = useRafraichir();
  const [s, setS] = useState(VIDE);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const maj = (c: Partial<typeof VIDE>) => setS((x) => ({ ...x, ...c }));

  async function envoyer() {
    setErreur(null);
    setMessage(null);
    const lu = veilleAvisSaisieSchema.safeParse(
      Object.fromEntries(Object.entries(s).filter(([, v]) => v.trim() !== "")),
    );
    if (!lu.success) {
      setErreur("Vérifiez l'intitulé, le pays (2 lettres) et la date limite (AAAA-MM-JJ).");
      return;
    }
    setEnCours(true);
    try {
      const r = await api.post<{ nouveau: boolean }>(`${API_VEILLE}/avis`, lu.data);
      setMessage(
        r.nouveau
          ? "Avis ajouté à la veille."
          : "Avis déjà connu : une occurrence a été ajoutée au résultat existant.",
      );
      setS(VIDE);
      rafraichir();
    } catch (e) {
      setErreur(messageVeille(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-formulaire"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void envoyer();
      }}
    >
      <Champ
        libelle="Intitulé de l'avis"
        required
        maxLength={300}
        value={s.titre}
        onChange={(e) => maj({ titre: e.target.value })}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Référence"
          maxLength={80}
          value={s.reference}
          onChange={(e) => maj({ reference: e.target.value })}
        />
        <Champ
          libelle="Bailleur"
          maxLength={150}
          value={s.bailleur}
          onChange={(e) => maj({ bailleur: e.target.value })}
        />
        <Champ
          libelle="Pays (code ISO)"
          maxLength={2}
          value={s.pays}
          onChange={(e) => maj({ pays: e.target.value })}
        />
        <Champ
          libelle="Secteur"
          maxLength={120}
          value={s.secteur}
          onChange={(e) => maj({ secteur: e.target.value })}
        />
        <Champ
          libelle="Date limite"
          type="date"
          value={s.date_limite}
          onChange={(e) => maj({ date_limite: e.target.value })}
        />
      </div>
      <ZoneTexte
        libelle="Objet"
        rows={3}
        maxLength={4000}
        value={s.objet}
        onChange={(e) => maj({ objet: e.target.value })}
      />
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {message ? (
        <Alerte tonalite="succes">
          <p>{message}</p>
        </Alerte>
      ) : null}
      <Bouton
        type="submit"
        variante="secondaire"
        chargement={enCours}
        texteChargement="Ajout…"
        disabled={s.titre.trim() === ""}
      >
        Ajouter l&apos;avis
      </Bouton>
    </form>
  );
}

/**
 * Import d'un fichier CSV ou JSON : le navigateur lit le fichier (1 Mo au plus) et poste son
 * TEXTE ; l'analyse, le dédoublonnage et le rapprochement sont faits par l'API. Les lignes en
 * erreur sont signalées, les lignes valides sont importées.
 */
export function VeilleImportFichier() {
  const { rafraichir } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);
  const [bilan, setBilan] = useState<BilanVeille | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function importer(fichier: File) {
    setErreur(null);
    setBilan(null);
    const verdict = verifierFichierImport(fichier);
    if (!verdict.ok) {
      setErreur(verdict.message);
      return;
    }
    setEnCours(true);
    try {
      const texte = await fichier.text();
      setBilan(
        await api.post<BilanVeille>(`${API_VEILLE}/import`, { texte, format: verdict.format }),
      );
      rafraichir();
    } catch (e) {
      setErreur(messageVeille(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <div className="mp-champ">
        <label className="mp-champ__libelle" htmlFor="veille-fichier">
          Fichier d&apos;avis (.csv ou .json)
        </label>
        <p className="mp-champ__aide">
          1 Mo et 200 avis au plus. En-têtes admis : référence, titre, objet, bailleur, pays,
          secteur, montant estimé, devise, date de publication, date limite, url, mots-clés.
        </p>
        <input
          id="veille-fichier"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          disabled={enCours}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importer(f);
          }}
        />
      </div>
      {enCours ? (
        <p className="mp-texte-doux" role="status">
          Import en cours…
        </p>
      ) : null}
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {bilan ? (
        <Alerte tonalite={bilan.erreurs && bilan.erreurs.length > 0 ? "attention" : "succes"}>
          <p>{texteBilanVeille(bilan)}</p>
          {bilan.erreurs && bilan.erreurs.length > 0 ? (
            <ul>
              {texteErreursImport(bilan.erreurs).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}
    </div>
  );
}
