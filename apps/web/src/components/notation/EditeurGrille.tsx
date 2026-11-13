"use client";

import { useState, type FormEvent } from "react";
import type { GrilleNotationDonnees } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  ajouterSecteur,
  anomaliesGrille,
  cheminVersionGrille,
  contenuDepuisEdition,
  editionDepuisContenu,
  messageGrille,
  messageSomme,
  messageSousTotal,
  retirerSecteur,
  sommeConforme,
  totauxEdition,
  type EditionGrille,
  type VersionGrille,
} from "../../lib/notation-grilles";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";

export interface EditeurGrilleProps {
  versionId: string;
  contenu: GrilleNotationDonnees;
  /** Expert qui pourrait valider : enregistrer fera de lui le dernier modificateur. */
  avertissement: string | null;
}

/** Somme affichée en direct : texte toujours écrit, icône et couleur en appui seulement. */
function Somme({
  total,
  portee,
  annoncer,
}: {
  total: number | null;
  portee: string;
  annoncer: boolean;
}) {
  const langue = useLangue();
  const ok = sommeConforme(total);
  return (
    <p
      className={`mp-notation-somme ${ok ? "mp-notation-somme--ok" : "mp-notation-somme--ecart"}`}
      aria-live={annoncer ? "polite" : undefined}
      aria-atomic={annoncer ? true : undefined}
    >
      <Icone nom={ok ? "succes" : "attention"} taille={18} />
      <span>{messageSomme(total, portee, langue)}</span>
    </p>
  );
}

/**
 * Édition d'un brouillon de grille : titre, poids par défaut des dimensions (regroupées par
 * famille) et surcharges par secteur (vide = poids par défaut), avec les sommes en direct.
 * Indicateurs et règles de conversion sont repris tels quels. Le contenu est contrôlé par le
 * schéma partagé ici, puis par le moteur de l'API ; la validation par un expert métier se fait
 * ensuite, sur la version enregistrée.
 */
export function EditeurGrille({ versionId, contenu, avertissement }: EditeurGrilleProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [edition, setEdition] = useState<EditionGrille>(() => editionDepuisContenu(contenu));
  const [anomalies, setAnomalies] = useState<string[]>([]);
  const [nouveauCode, setNouveauCode] = useState("");
  const [nouveauLibelle, setNouveauLibelle] = useState("");
  const [erreurAjout, setErreurAjout] = useState<{ code?: string; libelle?: string }>({});
  const totaux = totauxEdition(contenu.dimensions, edition, langue);
  const defaut = (dim: string) => edition.poids[dim] ?? "";

  const poids = (dim: string, v: string) =>
    setEdition((e) => ({ ...e, poids: { ...e.poids, [dim]: v } }));
  const poidsSecteur = (rang: number, dim: string, v: string) =>
    setEdition((e) => ({
      ...e,
      secteurs: e.secteurs.map((s, i) =>
        i === rang ? { ...s, poids: { ...s.poids, [dim]: v } } : s,
      ),
    }));
  const libelleSecteur = (rang: number, v: string) =>
    setEdition((e) => ({
      ...e,
      secteurs: e.secteurs.map((s, i) => (i === rang ? { ...s, libelle: v } : s)),
    }));

  function ajouter() {
    const r = ajouterSecteur(edition, nouveauCode, nouveauLibelle, langue);
    if (!r.ok) {
      setErreurAjout(r.erreurs);
      return;
    }
    setErreurAjout({});
    setEdition(r.charge);
    setNouveauCode("");
    setNouveauLibelle("");
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAnomalies([]);
    const ecart = totaux.total !== null && !sommeConforme(totaux.total);
    await f.envoyer(
      contenuDepuisEdition(contenu, edition, langue),
      (charge) => api.put<VersionGrille>(cheminVersionGrille(versionId), { contenu: charge }),
      {
        succes: ecart
          ? t(
              "Brouillon enregistré. Les poids par défaut ne totalisent pas 100 : le moteur les ramènera à 100 en proportion.",
              "Draft saved. The default weights do not total 100: the engine will scale them to 100 proportionally.",
            )
          : t("Brouillon enregistré.", "Draft saved."),
        messageSpecifique: (err) => {
          setAnomalies(anomaliesGrille(err));
          return messageGrille(err, langue);
        },
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale ?? f.erreurs.global ?? null}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Saving failed")}
      />
      {anomalies.length > 0 ? (
        <Alerte
          tonalite="danger"
          titre={t("Anomalies relevées par le moteur", "Anomalies found by the engine")}
          annonce="aucune"
        >
          <ul>
            {anomalies.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alerte>
      ) : null}
      {avertissement ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{avertissement}</p>
        </Alerte>
      ) : null}

      <Champ
        libelle={t("Titre de la grille", "Framework title")}
        required
        maxLength={200}
        value={edition.titre}
        onChange={(e) => setEdition((x) => ({ ...x, titre: e.target.value }))}
        erreur={f.erreurs.titre}
      />

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">
          {t("Poids par défaut des dimensions", "Default weights of the dimensions")}
        </legend>
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Seules les proportions comptent : le moteur ramène les poids à 100. Visez une somme de 100 pour qu'un poids se lise directement comme une part du score global.",
            "Only proportions matter: the engine scales the weights to 100. Aim for a sum of 100 so that a weight reads directly as a share of the overall score.",
          )}
        </p>
        {totaux.familles.map((fam) => (
          <div key={fam.famille} className="mp-notation-poids">
            <h3 className="mp-notation-barres__famille">{fam.libelle}</h3>
            <div className="mp-grille-champs mp-grille-champs--serree">
              {fam.dimensions.map((d) => (
                <Champ
                  key={d.id}
                  libelle={d.libelle}
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  value={defaut(d.id)}
                  onChange={(e) => poids(d.id, e.target.value)}
                  erreur={f.erreurs[`poids.${d.id}`]}
                />
              ))}
            </div>
            <p className="mp-texte-doux mp-texte-petit">
              {messageSousTotal(fam.total, fam.libelle, langue)}
            </p>
          </div>
        ))}
        <Somme
          total={totaux.total}
          portee={t("Total des dimensions", "Total of dimensions")}
          annoncer
        />
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">
          {t("Pondérations par secteur", "Weightings by sector")}
        </legend>
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Un secteur remplace tout ou partie des poids par défaut ; un champ vide garde le poids par défaut de la dimension (indiqué en exemple).",
            "A sector replaces all or part of the default weights; an empty field keeps the dimension's default weight (shown as an example).",
          )}
        </p>
        {edition.secteurs.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun secteur : seuls les poids par défaut s'appliquent.",
              "No sector: only the default weights apply.",
            )}
          </p>
        ) : null}
        <div className="mp-notation-secteurs">
          {edition.secteurs.map((s, rang) => (
            <div key={s.secteur} className="mp-sous-formulaire mp-notation-poids">
              <h3 className="mp-notation-barres__famille">
                {t("Secteur", "Sector")} {s.libelle.trim() || s.secteur}{" "}
                <span className="mp-texte-doux mp-texte-petit">({s.secteur})</span>
              </h3>
              {f.erreurs[`secteur.${rang}.code`] ? (
                <p className="mp-champ__erreur">{f.erreurs[`secteur.${rang}.code`]}</p>
              ) : null}
              <Champ
                libelle={t("Libellé du secteur", "Sector label")}
                maxLength={200}
                value={s.libelle}
                onChange={(e) => libelleSecteur(rang, e.target.value)}
                erreur={f.erreurs[`secteur.${rang}.libelle`]}
              />
              <div className="mp-grille-champs mp-grille-champs--serree">
                {contenu.dimensions.map((d) => (
                  <Champ
                    key={d.id}
                    libelle={d.libelle}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={defaut(d.id)}
                    value={s.poids[d.id] ?? ""}
                    onChange={(e) => poidsSecteur(rang, d.id, e.target.value)}
                    erreur={f.erreurs[`secteur.${rang}.${d.id}`]}
                    aria-label={t(
                      `${d.libelle}, secteur ${s.libelle.trim() || s.secteur} (vide : poids par défaut ${defaut(d.id) || "non renseigné"})`,
                      `${d.libelle}, sector ${s.libelle.trim() || s.secteur} (empty: default weight ${defaut(d.id) || "not set"})`,
                    )}
                  />
                ))}
              </div>
              <Somme
                total={totaux.secteurs[rang]?.total ?? null}
                portee={t(
                  `Secteur « ${s.libelle.trim() || s.secteur} »`,
                  `Sector "${s.libelle.trim() || s.secteur}"`,
                )}
                annoncer
              />
              <div className="mp-barre-actions">
                <Bouton
                  variante="discret"
                  icone="corbeille"
                  onClick={() => setEdition((e) => retirerSecteur(e, rang))}
                >
                  {t("Retirer ce secteur", "Remove this sector")}
                </Bouton>
              </div>
            </div>
          ))}
        </div>
        <div className="mp-sous-formulaire mp-pile">
          <h3 className="mp-notation-barres__famille">{t("Ajouter un secteur", "Add a sector")}</h3>
          <div className="mp-grille-champs">
            <Champ
              libelle={t("Code du secteur", "Sector code")}
              value={nouveauCode}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setNouveauCode(e.target.value)}
              erreur={erreurAjout.code}
              aide={t(
                "Minuscules sans accent (ex. btp). Les poids partent des poids par défaut.",
                "Lowercase without accents (e.g. construction). Weights start from the default weights.",
              )}
            />
            <Champ
              libelle={t("Libellé", "Label")}
              value={nouveauLibelle}
              maxLength={200}
              onChange={(e) => setNouveauLibelle(e.target.value)}
              erreur={erreurAjout.libelle}
            />
          </div>
          <div className="mp-barre-actions">
            <Bouton variante="secondaire" icone="plus" onClick={ajouter}>
              {t("Ajouter le secteur", "Add the sector")}
            </Bouton>
          </div>
        </div>
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer le brouillon", "Save draft")}
        </Bouton>
      </div>
    </form>
  );
}
