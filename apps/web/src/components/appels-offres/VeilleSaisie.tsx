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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
      setErreur(
        t(
          "Vérifiez l'intitulé, le pays (2 lettres) et la date limite (AAAA-MM-JJ).",
          "Check the title, the country (2 letters) and the deadline (YYYY-MM-DD).",
        ),
      );
      return;
    }
    setEnCours(true);
    try {
      const r = await api.post<{ nouveau: boolean }>(`${API_VEILLE}/avis`, lu.data);
      setMessage(
        r.nouveau
          ? t("Avis ajouté à la veille.", "Notice added to monitoring.")
          : t(
              "Avis déjà connu : une occurrence a été ajoutée au résultat existant.",
              "Notice already known: an occurrence was added to the existing result.",
            ),
      );
      setS(VIDE);
      rafraichir();
    } catch (e) {
      setErreur(messageVeille(e, langue));
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
        libelle={t("Intitulé de l'avis", "Notice title")}
        required
        maxLength={300}
        value={s.titre}
        onChange={(e) => maj({ titre: e.target.value })}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Référence", "Reference")}
          maxLength={80}
          value={s.reference}
          onChange={(e) => maj({ reference: e.target.value })}
        />
        <Champ
          libelle={t("Bailleur", "Donor")}
          maxLength={150}
          value={s.bailleur}
          onChange={(e) => maj({ bailleur: e.target.value })}
        />
        <Champ
          libelle={t("Pays (code ISO)", "Country (ISO code)")}
          maxLength={2}
          value={s.pays}
          onChange={(e) => maj({ pays: e.target.value })}
        />
        <Champ
          libelle={t("Secteur", "Sector")}
          maxLength={120}
          value={s.secteur}
          onChange={(e) => maj({ secteur: e.target.value })}
        />
        <Champ
          libelle={t("Date limite", "Deadline")}
          type="date"
          value={s.date_limite}
          onChange={(e) => maj({ date_limite: e.target.value })}
        />
      </div>
      <ZoneTexte
        libelle={t("Objet", "Subject")}
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
        texteChargement={t("Ajout…", "Adding…")}
        disabled={s.titre.trim() === ""}
      >
        {t("Ajouter l'avis", "Add the notice")}
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);
  const [bilan, setBilan] = useState<BilanVeille | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function importer(fichier: File) {
    setErreur(null);
    setBilan(null);
    const verdict = verifierFichierImport(fichier, langue);
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
      setErreur(messageVeille(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <div className="mp-champ">
        <label className="mp-champ__libelle" htmlFor="veille-fichier">
          {t("Fichier d'avis (.csv ou .json)", "Notices file (.csv or .json)")}
        </label>
        <p className="mp-champ__aide">
          {t(
            "1 Mo et 200 avis au plus. En-têtes admis : référence, titre, objet, bailleur, pays, secteur, montant estimé, devise, date de publication, date limite, url, mots-clés.",
            "1 MB and 200 notices at most. Accepted headers: référence, titre, objet, bailleur, pays, secteur, montant estimé, devise, date de publication, date limite, url, mots-clés.",
          )}
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
          {t("Import en cours…", "Import in progress…")}
        </p>
      ) : null}
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {bilan ? (
        <Alerte tonalite={bilan.erreurs && bilan.erreurs.length > 0 ? "attention" : "succes"}>
          <p>{texteBilanVeille(bilan, langue)}</p>
          {bilan.erreurs && bilan.erreurs.length > 0 ? (
            <ul>
              {texteErreursImport(bilan.erreurs, langue).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}
    </div>
  );
}
